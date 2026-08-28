'use client';
import { useEffect } from 'react';

/**
 * Раскрывает вопрос, на который указывает якорь в адресе.
 *
 * Нативный <details> сам этого не делает: браузер к нему прокрутит, но
 * оставит свёрнутым. Человек, которому в поддержке кинули ссылку вида
 * /faq#buffering, попал бы ровно на закрытый пункт — то есть ссылка выглядела
 * бы сломанной именно в тот момент, когда ей больше всего нужно сработать.
 */
export function FaqHashOpener() {
  useEffect(() => {
    function openFromHash() {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (!id) return;

      const target = document.getElementById(id);
      if (!(target instanceof HTMLDetailsElement) || target.open) return;

      target.open = true;
      // Раскрытие меняет высоту блока, и позиция, куда браузер уже прокрутил,
      // перестаёт быть верной. scrollIntoView учитывает scroll-mt-20.
      target.scrollIntoView();
    }

    openFromHash();
    window.addEventListener('hashchange', openFromHash);
    return () => window.removeEventListener('hashchange', openFromHash);
  }, []);

  return null;
}
