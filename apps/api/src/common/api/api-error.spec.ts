import { BadRequestException, HttpException, HttpStatus, NotFoundException } from '@nestjs/common';
import { ApiException, errorCodeForStatus, toApiErrorBody } from './api-error';

describe('errorCodeForStatus', () => {
  it.each([
    [400, 'BAD_REQUEST'],
    [401, 'UNAUTHORIZED'],
    [403, 'FORBIDDEN'],
    [404, 'NOT_FOUND'],
    [409, 'CONFLICT'],
    [413, 'PAYLOAD_TOO_LARGE'],
    [416, 'RANGE_NOT_SATISFIABLE'],
    [422, 'UNPROCESSABLE_ENTITY'],
    [429, 'TOO_MANY_REQUESTS'],
    [500, 'INTERNAL_SERVER_ERROR'],
    [503, 'SERVICE_UNAVAILABLE'],
  ])('%i → %s', (status, code) => {
    expect(errorCodeForStatus(status)).toBe(code);
  });

  it('статуса нет в таблице — HTTP_<n>, а не фраза из Node', () => {
    expect(errorCodeForStatus(418)).toBe('HTTP_418');
    expect(errorCodeForStatus(499)).toBe('HTTP_499');
  });
});

describe('toApiErrorBody', () => {
  it('старое исключение с текстом: добавляет code, сохраняет поля Nest', () => {
    expect(toApiErrorBody(new NotFoundException('Stream not found'))).toEqual({
      statusCode: 404,
      code: 'NOT_FOUND',
      message: 'Stream not found',
      error: 'Not Found',
    });
  });

  it('HttpException со строковым ответом', () => {
    expect(toApiErrorBody(new HttpException('nope', HttpStatus.FORBIDDEN))).toEqual({
      statusCode: 403,
      code: 'FORBIDDEN',
      message: 'nope',
    });
  });

  it('исключение без текста получает название статуса', () => {
    expect(toApiErrorBody(new NotFoundException())).toMatchObject({ code: 'NOT_FOUND', message: 'Not Found' });
  });

  it('массив сообщений склеивается в строку', () => {
    const body = toApiErrorBody(new BadRequestException(['a is bad', 'b is bad']));
    expect(body.message).toBe('a is bad; b is bad');
  });

  it('свои поля эндпоинта не теряются', () => {
    const body = toApiErrorBody(new BadRequestException({ message: 'x', retryAfter: 5 }));
    expect(body).toMatchObject({ statusCode: 400, code: 'BAD_REQUEST', message: 'x', retryAfter: 5 });
  });

  it('ApiException: конкретный код и поля', () => {
    const body = toApiErrorBody(
      new ApiException(HttpStatus.NOT_FOUND, 'EVENT_NOT_FOUND', 'Турнир не найден'),
    );
    expect(body).toEqual({ statusCode: 404, code: 'EVENT_NOT_FOUND', message: 'Турнир не найден' });
  });
});
