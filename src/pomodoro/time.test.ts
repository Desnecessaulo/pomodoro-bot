import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildIntervalMarks,
  buildNicknameSchedule,
  formatDuration,
  pomodoroNickname,
} from './time.js';

const MIN = 60_000;

test('apelido inicial de 25 minutos', () => {
  assert.equal(pomodoroNickname(25 * MIN), 'Pomodoro: 25m');
});

test('Pomodoro de 25 min atualiza para 15m aos 10 min e 5m aos 20 min', () => {
  assert.deepEqual(buildNicknameSchedule(25 * MIN, 10 * MIN, 5 * MIN), [
    { atMs: 10 * MIN, nickname: 'Pomodoro: 15m' },
    { atMs: 20 * MIN, nickname: 'Pomodoro: 5m' },
  ]);
});

test('aviso de 5 minutos é adicionado quando não coincide com o intervalo', () => {
  assert.deepEqual(
    buildNicknameSchedule(30 * MIN, 10 * MIN, 5 * MIN).map((s) => s.nickname),
    ['Pomodoro: 20m', 'Pomodoro: 10m', 'Pomodoro: 5m'],
  );
});

test('Pomodoros curtos não geram atualizações inválidas', () => {
  assert.deepEqual(buildNicknameSchedule(2 * MIN, 10 * MIN, 5 * MIN), []);
});

test('formatDuration', () => {
  assert.equal(formatDuration(25 * MIN), '25 minutos');
  assert.equal(formatDuration(MIN), '1 minuto');
  assert.equal(formatDuration(30_000), '30 segundos');
});

test('som de foco a cada 10 minutos, sem tocar no fim', () => {
  assert.deepEqual(buildIntervalMarks(25 * MIN, 10 * MIN), [10 * MIN, 20 * MIN]);
  assert.deepEqual(
    buildIntervalMarks(59 * MIN, 10 * MIN),
    [10, 20, 30, 40, 50].map((m) => m * MIN),
  );
  assert.deepEqual(buildIntervalMarks(20 * MIN, 10 * MIN), [10 * MIN]);
  assert.deepEqual(buildIntervalMarks(5 * MIN, 10 * MIN), []);
});
