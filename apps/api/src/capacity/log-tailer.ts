import * as fs from 'fs';

/**
 * Потолок чтения за один вызов.
 *
 * Если API постоял без сбора, хвост мог вырасти до сотен мегабайт, и попытка
 * взять его целиком — это всплеск памяти ровно в тот момент, когда серверу и
 * так тяжело. Остаток дочитается следующими вызовами.
 *
 * Четыре мегабайта на тик в 10 секунд — это порядка 2500 строк в секунду при
 * средней строке в 160 байт. Расчётный потолок сервера (~250 зрителей) даёт
 * около 250 строк в секунду, то есть запас десятикратный: сборщик не начнёт
 * отставать именно в тот момент, когда его показания нужнее всего.
 */
const MAX_READ_BYTES = 4 * 1024 * 1024;

/**
 * Сколько байт от начала файла держим как его «подпись».
 * Хватает, чтобы отличить один лог от другого: первая строка содержит время с
 * точностью до секунды и полный адрес запроса.
 */
const SIGNATURE_BYTES = 64;

/**
 * Хвост растущего файла.
 *
 * Первое чтение НЕ отдаёт то, что уже накопилось: при перезапуске API иначе
 * прилетел бы весь лог за сутки, и метрики показали бы всплеск отдачи,
 * которого не было.
 *
 * Ротацию ловим двумя признаками сразу. Уменьшение размера — быстрый и
 * очевидный случай (`copytruncate`, которым logrotate обычно и обрабатывает
 * nginx). Но его одного мало: если новый файл успел стать больше прежнего до
 * нашего следующего тика, размер вырастет, и мы продолжим читать с середины —
 * получая обрубки чужих строк. Поэтому сверяется ещё и начало файла: подменили
 * его — подпись не совпадёт, и чтение начнётся заново.
 *
 * Сравнение inode было бы естественнее, но при `copytruncate` inode не
 * меняется, а на Windows он к тому же неинформативен — тесты гоняются и там.
 */
export class LogTailer {
  /** Был ли уже первый вызов read(): по нему решается, пропускать ли прошлое. */
  private started = false;
  private offset: number | null = null;
  /** Хвост без перевода строки: дописанная наполовину строка ждёт продолжения. */
  private carry = '';
  private signature: string | null = null;

  constructor(private readonly filePath: string) {}

  /** Первые байты файла — по ним видно, что файл подменили. */
  private readSignature(size: number): string {
    if (size === 0) return '';
    let fd: number | null = null;
    try {
      fd = fs.openSync(this.filePath, 'r');
      const len = Math.min(size, SIGNATURE_BYTES);
      const buf = Buffer.alloc(len);
      const read = fs.readSync(fd, buf, 0, len, 0);
      return buf.toString('hex', 0, read);
    } catch {
      return '';
    } finally {
      if (fd !== null) fs.closeSync(fd);
    }
  }

  read(): string[] {
    let size: number;
    try {
      size = fs.statSync(this.filePath).size;
    } catch {
      // Файла нет: nginx ещё не писал или том не смонтирован. Отмечаем, что
      // старт состоялся — когда файл появится, он будет новым, и пропускать в
      // нём нечего.
      this.started = true;
      return [];
    }

    const signature = this.readSignature(size);

    if (!this.started) {
      // Файл существовал ещё до нашего запуска — всё, что в нём есть, к нашему
      // интервалу измерения отношения не имеет.
      this.started = true;
      this.offset = size;
      this.signature = signature;
      return [];
    }

    // Файл появился уже после старта — читаем его с начала.
    if (this.offset === null) this.offset = 0;

    // Пока файл короче SIGNATURE_BYTES, подпись растёт вместе с ним, и прямое
    // сравнение объявляло бы ротацией обычную дозапись. Тот же файл — тот, чья
    // подпись остаётся продолжением прежней.
    const sameFile =
      this.signature === null ||
      signature.startsWith(this.signature) ||
      this.signature.startsWith(signature);

    if (size < this.offset || !sameFile) {
      this.offset = 0;
      this.carry = '';
    }
    this.signature = signature;

    if (size === this.offset) return [];

    let chunk = '';
    let fd: number | null = null;
    try {
      fd = fs.openSync(this.filePath, 'r');
      const len = Math.min(size - this.offset, MAX_READ_BYTES);
      const buf = Buffer.alloc(len);
      const bytesRead = fs.readSync(fd, buf, 0, len, this.offset);
      chunk = buf.toString('utf8', 0, bytesRead);
      this.offset += bytesRead;
    } catch {
      // Гонка с ротацией: файл подменили между stat и open. Данные этого тика
      // потеряны, следующий прочитает уже новый файл.
      return [];
    } finally {
      if (fd !== null) fs.closeSync(fd);
    }

    const lines = (this.carry + chunk).split('\n');
    this.carry = lines.pop() ?? '';
    return lines.filter((l) => l.length > 0);
  }
}
