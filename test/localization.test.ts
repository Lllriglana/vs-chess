import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Memento } from 'vscode';
import { languages } from '../src/shared/languages';
import { defaults, parseAction } from '../src/shared/protocol';
import { Storage } from '../src/storage/storage';
import { translate } from '../src/ui/translations';

test('every language renders the named hint square and keeps chess notation', () => {
  const hints = languages.map(language => translate(language, 'Hint · Move the piece on {square}', { square: 'b7' }));
  assert.equal(new Set(hints).size, languages.length);
  assert.ok(hints.every(hint => hint.includes('b7') && !hint.includes('{square}')));
  assert.equal(translate('ru', 'Checkmate'), 'Мат');
  assert.equal(translate('ru', 'Try another move.'), 'Попробуйте другой ход.');
  assert.equal(translate('zh-CN', 'Nf3'), 'Nf3');
});

test('language settings validate and upgrade preferences saved before localization', async () => {
  const key = 'vsChess.preferences.v1';
  const values: Record<string, unknown> = {};
  const { language: _, ...old } = defaults;
  values[key] = { ...old, level: 8, theme: 'dark' };
  const memento: Memento = {
    keys: () => Object.keys(values),
    get: <T>(name: string, fallback?: T) => values[name] as T ?? fallback as T,
    update: async (name, value) => { values[name] = value; }
  };
  const storage = new Storage(memento, memento, error => assert.fail(String(error)));
  const migrated = storage.loadPreferences();
  assert.deepEqual(migrated, { ...old, level: 8, theme: 'dark', language: 'en' });
  const updated = { ...migrated, language: 'ru' } as const;
  assert.deepEqual(parseAction({ type: 'settings', preferences: updated }),
    { type: 'settings', preferences: updated });
  assert.equal(parseAction({ type: 'settings', preferences: { ...updated, language: 'zz' } }), undefined);
  storage.savePreferences(updated);
  await storage.flush();
  assert.deepEqual(storage.loadPreferences(), updated);
});
