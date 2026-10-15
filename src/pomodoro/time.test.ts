import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  breakDurationFor,
  breakNickname,
  buildFocusSoundMarks,
  buildIntervalMarks,
  buildNicknameSchedule,
  formatClock,
  formatDuration,
  formatRemainingText,
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

test('apelido atualiza a cada 5 minutos: 25m -> 20m, 15m, 10m, 5m', () => {
  assert.deepEqual(buildNicknameSchedule(25 * MIN, 5 * MIN, 5 * MIN), [
    { atMs: 5 * MIN, nickname: 'Pomodoro: 20m' },
    { atMs: 10 * MIN, nickname: 'Pomodoro: 15m' },
    { atMs: 15 * MIN, nickname: 'Pomodoro: 10m' },
    { atMs: 20 * MIN, nickname: 'Pomodoro: 5m' },
  ]);
});

test('apelido da pausa', () => {
  assert.equal(breakNickname(5 * MIN), 'Pomodoro PAUSA: 5m');
  assert.deepEqual(buildNicknameSchedule(10 * MIN, 5 * MIN, 5 * MIN, breakNickname), [
    { atMs: 5 * MIN, nickname: 'Pomodoro PAUSA: 5m' },
  ]);
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

test('som de foco também toca faltando 5 minutos', () => {
  assert.deepEqual(buildFocusSoundMarks(25 * MIN, 10 * MIN, 5 * MIN), [10 * MIN, 20 * MIN]);
  assert.deepEqual(
    buildFocusSoundMarks(30 * MIN, 10 * MIN, 5 * MIN),
    [10, 20, 25].map((m) => m * MIN),
  );
  assert.deepEqual(
    buildFocusSoundMarks(59 * MIN, 10 * MIN, 5 * MIN),
    [10, 20, 30, 40, 50, 54].map((m) => m * MIN),
  );
  assert.deepEqual(buildFocusSoundMarks(5 * MIN, 10 * MIN, 5 * MIN), []);
});

test('formatRemainingText', () => {
  assert.equal(formatRemainingText(24 * MIN), '24 minutos restantes');
  assert.equal(formatRemainingText(MIN), '1 minuto restante');
  assert.equal(formatRemainingText(30_000), '30 segundos restantes');
});

test('formatClock usa o horário de Brasília', () => {
  // 12:35 UTC = 09:35 em Brasília (UTC-3).
  assert.equal(formatClock(Date.UTC(2026, 9, 14, 12, 35)), '09:35');
});

test('duração da pausa conforme o Pomodoro', () => {
  assert.equal(breakDurationFor(24 * MIN), undefined);
  assert.equal(breakDurationFor(25 * MIN), 5 * MIN);
  assert.equal(breakDurationFor(49 * MIN), 5 * MIN);
  assert.equal(breakDurationFor(50 * MIN), 10 * MIN);
  assert.equal(breakDurationFor(59 * MIN), 10 * MIN);
});
