'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');

delete process.env.OPENAI_API_KEY;

const { server, tasks } = require('../server.js');
const listening = server.listening ? Promise.resolve() : once(server, 'listening');

test('Kanban API and frontend smoke tests', async t => {
  await listening;
  tasks.length = 0;
  const base = 'http://127.0.0.1:' + server.address().port;

  t.after(async () => {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });

  await t.test('health endpoint responds', async () => {
    const response = await fetch(base + '/api/health');
    assert.equal(response.status, 200);
    assert.equal((await response.json()).status, 'ok');
  });

  await t.test('serves the single-page application', async () => {
    const response = await fetch(base + '/');
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Мои задачи/);
  });

  await t.test('validates required task title', async () => {
    const response = await fetch(base + '/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '   ' })
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, 'VALIDATION_ERROR');
  });

  let task;
  await t.test('creates a task and lists it', async () => {
    const response = await fetch(base + '/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Тестовая задача', description: 'Проверить API', column: 'backlog' })
    });
    assert.equal(response.status, 201);
    task = (await response.json()).task;
    assert.equal(task.title, 'Тестовая задача');
    assert.equal(task.column, 'backlog');
    assert.ok(task.id);

    const listResponse = await fetch(base + '/api/tasks');
    const list = await listResponse.json();
    assert.equal(list.total, 1);
    assert.equal(list.tasks[0].id, task.id);
  });

  await t.test('moves a task between columns', async () => {
    const response = await fetch(base + '/api/tasks/' + task.id, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ column: 'in-progress' })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.task.column, 'in-progress');
  });

  let subtask;
  await t.test('generates four fallback subtasks without an API key', async () => {
    const response = await fetch(base + '/api/tasks/' + task.id + '/suggest-subtasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.provider, 'template');
    assert.equal(body.subtasks.length, 4);
    subtask = body.subtasks[0];
    assert.equal(subtask.completed, false);
  });

  await t.test('persists subtask checkbox state', async () => {
    const response = await fetch(base + '/api/tasks/' + task.id + '/subtasks/' + subtask.id, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ completed: true })
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).subtask.completed, true);
  });

  await t.test('returns structured 404 errors for missing tasks', async () => {
    const response = await fetch(base + '/api/tasks/missing-id');
    assert.equal(response.status, 404);
    assert.equal((await response.json()).error.code, 'TASK_NOT_FOUND');
  });
});
