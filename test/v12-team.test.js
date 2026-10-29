import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { discoverTeam, parseFrontmatter, projectDirOf, EMPTY_TEAM } from '../src/team.js';

/** Pasta temporária; nunca usa o home real. */
function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'v12-team-'));
}
function put(root, rel, content) {
  const f = path.join(root, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, content);
  return f;
}
const agent = (name, extra = '', body = 'corpo') => `---\n${name === null ? '' : `name: ${name}\n`}description: d-${name}\nmodel: sonnet\n${extra}---\n${body}\n`;
const abs = (w) => /(^|[\s"'])\/(tmp|var|home)\//.test(w) || w.includes(os.tmpdir());

test('projectDirOf: pasta pai de .monitor, senão null', () => {
  assert.equal(projectDirOf('/a/b/.monitor/events.jsonl'), '/a/b');
  assert.equal(projectDirOf('/a/b/events.jsonl'), null);
  assert.equal(projectDirOf('/a/b/.monitor/x/events.jsonl'), null);
  assert.equal(projectDirOf(''), null);
  assert.equal(projectDirOf(undefined), null);
});

test('sem projeto e sem home: time vazio, sem avisos', () => {
  const t = discoverTeam({});
  assert.equal(t.defs.size, 0);
  assert.deepEqual(t.config, { papeis: {}, nativos: [] });
  assert.deepEqual(t.warnings, []);
  assert.equal(EMPTY_TEAM.defs.size, 0);
  assert.deepEqual(discoverTeam(), discoverTeam({}));
});

test('lê definições do projeto; name ausente cai para o nome do arquivo', () => {
  const p = tmp();
  put(p, '.claude/agents/arq.md', agent('arquiteto'));
  put(p, '.claude/agents/sem-nome.md', agent(null));
  put(p, '.claude/agents/leia.txt', agent('ignorado'));
  fs.mkdirSync(path.join(p, '.claude/agents/pasta.md'));
  const t = discoverTeam({ projectDir: p });
  assert.deepEqual([...t.defs.keys()].sort(), ['arquiteto', 'sem-nome']);
  assert.equal(t.defs.get('arquiteto').origem, 'projeto');
  assert.equal(t.defs.get('arquiteto').description, 'd-arquiteto');
  assert.equal(t.defs.get('arquiteto').model, 'sonnet');
  assert.equal(t.defs.get('sem-nome').name, 'sem-nome');
  assert.deepEqual(t.warnings, []);
});

test('projeto vence o global para o mesmo name; global complementa', () => {
  const p = tmp();
  const h = tmp();
  put(p, '.claude/agents/a.md', '---\nname: dba\ndescription: do projeto\n---\n');
  put(h, '.claude/agents/b.md', '---\nname: dba\ndescription: do global\n---\n');
  put(h, '.claude/agents/c.md', '---\nname: extra\n---\n');
  const t = discoverTeam({ projectDir: p, homeDir: h });
  assert.equal(t.defs.get('dba').description, 'do projeto');
  assert.equal(t.defs.get('dba').origem, 'projeto');
  assert.equal(t.defs.get('extra').origem, 'global');
});

test('sem projectDir nem homeDir nada é lido, mesmo com pastas existentes', () => {
  const h = tmp();
  put(h, '.claude/agents/x.md', agent('x'));
  assert.equal(discoverTeam({ projectDir: null, homeDir: null }).defs.size, 0);
});

test('arquivo sem frontmatter é ignorado com aviso sem caminho absoluto', () => {
  const p = tmp();
  put(p, '.claude/agents/quebrado.md', 'só texto, sem frontmatter\n');
  put(p, '.claude/agents/aberto.md', '---\nname: aberto\nsem fechar\n');
  put(p, '.claude/agents/ok.md', agent('ok'));
  const t = discoverTeam({ projectDir: p });
  assert.deepEqual([...t.defs.keys()], ['ok']);
  assert.deepEqual(t.warnings, [
    'agentes: projeto/aberto.md ignorado: sem frontmatter',
    'agentes: projeto/quebrado.md ignorado: sem frontmatter',
  ]);
  assert.ok(t.warnings.every((w) => !abs(w)));
});

test('arquivo acima de 256 KB é ignorado com aviso; exatamente 256 KB entra', () => {
  const p = tmp();
  const head = '---\nname: grande\n---\n';
  put(p, '.claude/agents/grande.md', head + 'x'.repeat(256 * 1024 - head.length + 1));
  put(p, '.claude/agents/limite.md', '---\nname: limite\n---\n' + 'x'.repeat(256 * 1024 - '---\nname: limite\n---\n'.length));
  const t = discoverTeam({ projectDir: p });
  assert.deepEqual([...t.defs.keys()], ['limite']);
  assert.deepEqual(t.warnings, ['agentes: projeto/grande.md ignorado: maior que 256 KB']);
});

test('arquivo ilegível (chmod 000) é ignorado com aviso', { skip: process.getuid?.() === 0 }, () => {
  const p = tmp();
  const f = put(p, '.claude/agents/trancado.md', agent('trancado'));
  fs.chmodSync(f, 0o000);
  try {
    const t = discoverTeam({ projectDir: p });
    assert.equal(t.defs.size, 0);
    assert.deepEqual(t.warnings, ['agentes: projeto/trancado.md ignorado: ilegível']);
  } finally {
    fs.chmodSync(f, 0o644);
  }
});

test('parseFrontmatter: aspas, BOM, CRLF, > e | viram null, indentadas ignoradas', () => {
  const fm = parseFrontmatter(
    '﻿---\r\nname: "meu-agente"\r\ndescription: >\r\n  texto dobrado\r\nmodel: \'opus\'\r\ntools: Read\r\n  name: falso\r\n---\r\ncorpo\r\n',
  );
  assert.equal(fm.name, 'meu-agente');
  assert.equal(fm.description, null);
  assert.equal(fm.model, 'opus');
  assert.equal(fm.tools, undefined);
  assert.equal(fm.body, 'corpo\n');
  assert.equal(parseFrontmatter('---\ndescription: |\n  x\nmodel:\n---\n').description, null);
  assert.equal(parseFrontmatter('---\ndescription: |\n  x\nmodel:\n---\n').model, null);
  assert.equal(parseFrontmatter('sem\n---\nname: x\n---\n'), null);
  assert.equal(parseFrontmatter(42), null);
});

test('description cortada em 300 e model em 40', () => {
  const p = tmp();
  put(p, '.claude/agents/a.md', `---\nname: a\ndescription: ${'d'.repeat(400)}\nmodel: ${'m'.repeat(60)}\n---\n`);
  const d = discoverTeam({ projectDir: p }).defs.get('a');
  assert.equal(d.description.length, 300);
  assert.equal(d.model.length, 40);
});

test('validador é detectado pelo corpo, não pelo frontmatter', () => {
  const p = tmp();
  put(p, '.claude/agents/rev.md', agent('rev', '', '## Resultado: APROVADO | REPROVADO'));
  put(p, '.claude/agents/rev2.md', agent('rev2', '', 'Resultado:  **APROVADO  |  REPROVADO'));
  put(p, '.claude/agents/dba.md', agent('dba', '', 'Diga Resultado: APROVADO se ok'));
  put(p, '.claude/agents/fm.md', '---\nname: fm\ndescription: Resultado: APROVADO | REPROVADO\n---\nnada\n');
  const t = discoverTeam({ projectDir: p });
  assert.equal(t.defs.get('rev').validador, true);
  assert.equal(t.defs.get('rev2').validador, true);
  assert.equal(t.defs.get('dba').validador, false);
  assert.equal(t.defs.get('fm').validador, false);
});

test('config: global -> projeto campo a campo; nativos é a união', () => {
  const p = tmp();
  const h = tmp();
  put(h, '.claude/monitor.json', JSON.stringify({
    papeis: { dba: { nome: 'DBA', cor: '#111111', nivel: 2 }, so_global: { sigla: 'SG' } },
    nativos: ['a', 'b'],
  }));
  put(p, '.claude/monitor.json', JSON.stringify({
    papeis: { dba: { cor: '#222222', validador: true } },
    nativos: ['b', 'c'],
  }));
  const t = discoverTeam({ projectDir: p, homeDir: h });
  assert.deepEqual(t.config.papeis.dba, { nome: 'DBA', cor: '#222222', nivel: 2, validador: true });
  assert.deepEqual(t.config.papeis.so_global, { sigla: 'SG' });
  assert.deepEqual(t.config.nativos.sort(), ['a', 'b', 'c']);
  assert.deepEqual(t.warnings, []);
});

test('--config vence global e projeto, campo a campo', () => {
  const p = tmp();
  const h = tmp();
  put(h, '.claude/monitor.json', JSON.stringify({ papeis: { x: { nome: 'G', sigla: 'GG' } } }));
  put(p, '.claude/monitor.json', JSON.stringify({ papeis: { x: { nome: 'P', cor: '#AAAAAA' } }, nativos: ['n1'] }));
  const cfg = put(tmp(), 'minha.json', JSON.stringify({ papeis: { x: { nome: 'C' } }, nativos: ['n2'] }));
  const t = discoverTeam({ projectDir: p, homeDir: h, configPath: cfg });
  assert.deepEqual(t.config.papeis.x, { nome: 'C', sigla: 'GG', cor: '#AAAAAA' });
  assert.deepEqual(t.config.nativos, ['n1', 'n2']);
});

test('JSON inválido e --config inexistente viram aviso e não derrubam nada', () => {
  const p = tmp();
  const h = tmp();
  put(p, '.claude/agents/a.md', agent('a'));
  put(h, '.claude/monitor.json', '{ quebrado');
  const t = discoverTeam({ projectDir: p, homeDir: h, configPath: path.join(tmp(), 'nao-existe.json') });
  assert.equal(t.defs.size, 1);
  assert.deepEqual(t.warnings, [
    'config: global monitor.json: JSON inválido',
    'config: --config nao-existe.json: ilegível',
  ]);
  assert.ok(t.warnings.every((w) => !abs(w)));
});

test('config ausente em projeto/global é silenciosa', () => {
  assert.deepEqual(discoverTeam({ projectDir: tmp(), homeDir: tmp() }).warnings, []);
});

test('config de raiz que não é objeto vira aviso', () => {
  const p = tmp();
  put(p, '.claude/monitor.json', '[1,2]');
  const t = discoverTeam({ projectDir: p });
  assert.deepEqual(t.warnings, ['config: projeto monitor.json: esperado um objeto JSON']);
});

test('config acima de 64 KB é ignorada com aviso', () => {
  const p = tmp();
  put(p, '.claude/monitor.json', JSON.stringify({ nativos: ['x'.repeat(70 * 1024)] }));
  const t = discoverTeam({ projectDir: p });
  assert.deepEqual(t.config.nativos, []);
  assert.deepEqual(t.warnings, ['config: projeto monitor.json: ignorado: maior que 64 KB']);
});

test('campos de tipo errado são ignorados com aviso; os válidos ficam', () => {
  const p = tmp();
  put(p, '.claude/monitor.json', JSON.stringify({
    papeis: {
      dba: { nome: 5, sigla: '', cor: 'vermelho', ordem: '1', nivel: null, validador: 'sim' },
      ok: { nome: 'Ok', sigla: 'OK', cor: '#0f0F0f', ordem: 3, nivel: 2, validador: false },
      ruim: 'texto',
    },
    nativos: ['a', 7],
  }));
  const t = discoverTeam({ projectDir: p });
  assert.deepEqual(t.config.papeis.dba, {});
  assert.deepEqual(t.config.papeis.ok, { nome: 'Ok', sigla: 'OK', cor: '#0f0F0f', ordem: 3, nivel: 2, validador: false });
  assert.equal(t.config.papeis.ruim, undefined);
  assert.deepEqual(t.config.nativos, ['a']);
  assert.ok(t.warnings.includes('config: projeto monitor.json: papeis.dba.cor ignorado: esperado #RRGGBB'));
  assert.ok(t.warnings.includes('config: projeto monitor.json: papeis.dba.ordem ignorado: esperado número'));
  assert.ok(t.warnings.includes('config: projeto monitor.json: papeis.dba.validador ignorado: esperado true ou false'));
  assert.ok(t.warnings.includes('config: projeto monitor.json: papeis.ruim ignorado: esperado objeto'));
  assert.equal(t.warnings.length, 8);
  assert.ok(t.warnings.every((w) => !abs(w)));
});

test('nome > 40 caracteres e cor sem # são rejeitados', () => {
  const p = tmp();
  put(p, '.claude/monitor.json', JSON.stringify({ papeis: { a: { nome: 'x'.repeat(41), cor: '123456' } } }));
  const t = discoverTeam({ projectDir: p });
  assert.deepEqual(t.config.papeis.a, {});
  assert.equal(t.warnings.length, 2);
});

test('mudança no arquivo aparece na próxima descoberta (cache por mtime:size)', () => {
  const p = tmp();
  const f = put(p, '.claude/agents/a.md', agent('a'));
  assert.equal(discoverTeam({ projectDir: p }).defs.get('a').validador, false);
  fs.writeFileSync(f, agent('a', '', '## Resultado: APROVADO | REPROVADO'));
  assert.equal(discoverTeam({ projectDir: p }).defs.get('a').validador, true);
  fs.rmSync(f);
  assert.equal(discoverTeam({ projectDir: p }).defs.size, 0);
});

test('não lança com entradas inexistentes ou inválidas', () => {
  const t = discoverTeam({ projectDir: '/nao/existe/de/jeito/nenhum', homeDir: '/nao/existe/tambem', configPath: '/nao/existe.json' });
  assert.equal(t.defs.size, 0);
  assert.deepEqual(t.warnings, ['config: --config existe.json: ilegível']);
});

test('fixtures/time-diferente: 3 definições, só o revisor é validador, SEC vem da config', () => {
  const root = path.resolve(import.meta.dirname, '..', 'fixtures', 'time-diferente');
  const t = discoverTeam({ projectDir: projectDirOf(path.join(root, '.monitor', 'events.jsonl')), homeDir: null });
  assert.deepEqual([...t.defs.keys()].sort(), ['arquiteto', 'dba', 'revisor-seguranca']);
  assert.deepEqual([...t.defs.values()].filter((d) => d.validador).map((d) => d.name), ['revisor-seguranca']);
  assert.equal(t.config.papeis['revisor-seguranca'].sigla, 'SEC');
  assert.deepEqual(t.warnings, []);
});
