'use strict';

const express = require('express');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const COLUMNS = new Set(['backlog', 'in-progress', 'done']);
const tasks = [];

app.disable('x-powered-by');
app.use(express.json({ limit: '32kb', strict: true }));

class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function textField(value, field, max, required = false) {
  if (typeof value !== 'string') throw new ApiError(400, 'VALIDATION_ERROR', field + ' must be a string');
  const result = value.trim();
  if (required && !result) throw new ApiError(400, 'VALIDATION_ERROR', field + ' is required');
  if (result.length > max) throw new ApiError(400, 'VALIDATION_ERROR', field + ' is too long');
  return result;
}

function getTask(id) {
  const task = tasks.find(item => item.id === id);
  if (!task) throw new ApiError(404, 'TASK_NOT_FOUND', 'Task not found');
  return task;
}

function serialize(task) {
  return { ...task, subtasks: task.subtasks.map(item => ({ ...item })) };
}

app.get('/api/health', (req, res) => res.json({ status: 'ok', tasks: tasks.length }));

app.get('/api/tasks', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ tasks: tasks.map(serialize), total: tasks.length });
});

app.post('/api/tasks', (req, res) => {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Request body must be an object');
  }
  if (tasks.length >= 1000) throw new ApiError(507, 'TASK_LIMIT_REACHED', 'Task limit reached');
  const title = textField(req.body.title, 'title', 200, true);
  const description = textField(req.body.description ?? '', 'description', 5000);
  const column = req.body.column ?? 'backlog';
  if (!COLUMNS.has(column)) throw new ApiError(400, 'INVALID_COLUMN', 'Invalid column');
  const now = new Date().toISOString();
  const task = { id: randomUUID(), title, description, column, subtasks: [], subtasksGenerated: false, createdAt: now, updatedAt: now };
  tasks.unshift(task);
  res.status(201).json({ task: serialize(task) });
});

app.put('/api/tasks/:id', (req, res) => {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Request body must be an object');
  }
  const task = getTask(req.params.id);
  const keys = Object.keys(req.body);
  if (!keys.length) throw new ApiError(400, 'VALIDATION_ERROR', 'At least one field is required');
  for (const key of keys) {
    if (!['title', 'description', 'column'].includes(key)) {
      throw new ApiError(400, 'INVALID_FIELD', 'Unsupported field: ' + key);
    }
  }
  if (Object.hasOwn(req.body, 'title')) task.title = textField(req.body.title, 'title', 200, true);
  if (Object.hasOwn(req.body, 'description')) task.description = textField(req.body.description, 'description', 5000);
  if (Object.hasOwn(req.body, 'column')) {
    if (!COLUMNS.has(req.body.column)) throw new ApiError(400, 'INVALID_COLUMN', 'Invalid column');
    task.column = req.body.column;
  }
  task.updatedAt = new Date().toISOString();
  res.json({ task: serialize(task) });
});

app.post('/api/tasks/:id/suggest-subtasks', (req, res) => {
  const task = getTask(req.params.id);
  const title = task.title;
  task.subtasks = [
    { title: 'Уточнить требования и критерии успеха', description: 'Определить ожидаемый результат и ограничения.' },
    { title: 'Подготовить план реализации', description: 'Разбить работу на понятные последовательные шаги.' },
    { title: 'Выполнить основную работу', description: 'Реализовать задачу: ' + title },
    { title: 'Проверить результат', description: 'Протестировать сценарии и исправить найденные ошибки.' }
  ].map(item => ({ id: randomUUID(), ...item, completed: false }));
  task.subtasksGenerated = true;
  task.updatedAt = new Date().toISOString();
  res.json({ taskId: task.id, provider: 'demo', subtasks: task.subtasks });
});

app.use('/api', (req, res, next) => next(new ApiError(404, 'ROUTE_NOT_FOUND', 'API endpoint not found')));
app.use(express.static(__dirname, { index: false, dotfiles: 'deny', maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0 }));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err instanceof SyntaxError && Object.hasOwn(err, 'body')) {
    return res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Invalid JSON body' } });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' } });
  }
  const status = err instanceof ApiError ? err.status : 500;
  if (status === 500) console.error(err);
  return res.status(status).json({
    error: {
      code: err instanceof ApiError ? err.code : 'INTERNAL_SERVER_ERROR',
      message: err instanceof ApiError ? err.message : 'Unexpected server error'
    }
  });
});

const server = app.listen(PORT, '0.0.0.0', () => console.log('Flowboard listening on port ' + PORT));
server.requestTimeout = 30000;
server.headersTimeout = 35000;

function shutdown() {
  server.close(error => {
    if (error) {
      console.error(error);
      process.exitCode = 1;
    }
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

module.exports = { app, server, tasks };
