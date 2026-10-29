// Golden da v1.1 (gerado ANTES de mexer em src/ na v1.2): arestas, tipos e colunas de cada sessão das
// fixtures antigas, com e sem hideOthers. Prova 23(g): a v1.2 (níveis por estreia R15, papéis dinâmicos R14)
// gera as mesmas arestas. Usa só a assinatura da v1.1 (sem team), que na v1.2 equivale a EMPTY_TEAM.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildModel } from '../src/model.js';
import { buildEdges } from '../src/edges.js';
import { fixture } from './_helpers.js';

const GOLDEN = {
 "cenario-usuario": {
  "sess-cenario-0001": {
   "todos": {
    "edges": [
     "a-des>a-qa1:avanço",
     "a-dev2>a-qa2:avanço",
     "a-dev>a-qa1:avanço",
     "a-pm>a-des:avanço",
     "a-pm>a-dev:avanço",
     "a-qa1>a-dev2:retorno"
    ],
    "batches": {
     "a-pm": 1,
     "a-dev": 2,
     "a-des": 2,
     "a-qa1": 3,
     "a-dev2": 4,
     "a-qa2": 5
    }
   },
   "oculto": {
    "edges": [
     "a-des>a-qa1:avanço",
     "a-dev2>a-qa2:avanço",
     "a-dev>a-qa1:avanço",
     "a-pm>a-des:avanço",
     "a-pm>a-dev:avanço",
     "a-qa1>a-dev2:retorno"
    ],
    "batches": {
     "a-pm": 1,
     "a-dev": 2,
     "a-des": 2,
     "a-qa1": 3,
     "a-dev2": 4,
     "a-qa2": 5
    }
   }
  }
 },
 "cenario-time-novo": {
  "sess-time-novo-0001": {
   "todos": {
    "edges": [
     "a-be>a-qa1:avanço",
     "a-des>a-tl:avanço",
     "a-fe2>a-qa2:avanço",
     "a-fe>a-qa1:avanço",
     "a-pm>a-des:avanço",
     "a-qa1>a-fe2:retorno",
     "a-tl>a-be:avanço",
     "a-tl>a-fe:avanço"
    ],
    "batches": {
     "a-pm": 1,
     "a-des": 2,
     "a-tl": 3,
     "a-be": 4,
     "a-fe": 4,
     "a-qa1": 5,
     "a-fe2": 6,
     "a-qa2": 7
    }
   },
   "oculto": {
    "edges": [
     "a-be>a-qa1:avanço",
     "a-des>a-tl:avanço",
     "a-fe2>a-qa2:avanço",
     "a-fe>a-qa1:avanço",
     "a-pm>a-des:avanço",
     "a-qa1>a-fe2:retorno",
     "a-tl>a-be:avanço",
     "a-tl>a-fe:avanço"
    ],
    "batches": {
     "a-pm": 1,
     "a-des": 2,
     "a-tl": 3,
     "a-be": 4,
     "a-fe": 4,
     "a-qa1": 5,
     "a-fe2": 6,
     "a-qa2": 7
    }
   }
  },
  "sess-time-novo-0002": {
   "todos": {
    "edges": [
     "b-be>b-qa2:avanço",
     "b-fe>b-qa2:avanço",
     "b-qa1>b-be:retorno",
     "b-qa1>b-fe:retorno"
    ],
    "batches": {
     "b-qa1": 1,
     "b-be": 2,
     "b-fe": 2,
     "b-qa2": 3
    }
   },
   "oculto": {
    "edges": [
     "b-be>b-qa2:avanço",
     "b-fe>b-qa2:avanço",
     "b-qa1>b-be:retorno",
     "b-qa1>b-fe:retorno"
    ],
    "batches": {
     "b-qa1": 1,
     "b-be": 2,
     "b-fe": 2,
     "b-qa2": 3
    }
   }
  }
 },
 "edge-cases": {
  "sess-edge-B": {
   "todos": {
    "edges": [],
    "batches": {
     "b-des": 1
    }
   },
   "oculto": {
    "edges": [],
    "batches": {
     "b-des": 1
    }
   }
  },
  "sess-edge-A": {
   "todos": {
    "edges": [
     "a-exp>a-dev-run:avanço"
    ],
    "batches": {
     "a-exp": 1,
     "a-dev-run": 2
    }
   },
   "oculto": {
    "edges": [],
    "batches": {
     "a-dev-run": 1
    }
   }
  }
 },
 "ao-vivo": {
  "sess-live-0001": {
   "todos": {
    "edges": [
     "l-dev>l-qa:avanço",
     "l-pm>l-dev:avanço"
    ],
    "batches": {
     "l-pm": 1,
     "l-dev": 2,
     "l-qa": 3
    }
   },
   "oculto": {
    "edges": [
     "l-dev>l-qa:avanço",
     "l-pm>l-dev:avanço"
    ],
    "batches": {
     "l-pm": 1,
     "l-dev": 2,
     "l-qa": 3
    }
   }
  }
 }
};

for (const [nome, sessoes] of Object.entries(GOLDEN)) {
  for (const [sid, modos] of Object.entries(sessoes)) {
    test(`equivalência v1.1: ${nome} / ${sid} (com e sem hideOthers)`, () => {
      const m = buildModel(fixture(nome));
      const mine = m.executions.filter((e) => (e.session_id ?? '') === sid);
      assert.ok(mine.length > 0);
      for (const [modo, esperado] of Object.entries(modos)) {
        const r = buildEdges(mine, { hideOthers: modo === 'oculto' });
        const rotulo = `${sid} / ${modo}`;
        assert.deepEqual(r.edges.map((e) => `${e.from}>${e.to}:${e.type}`).sort(), esperado.edges, rotulo);
        assert.deepEqual(Object.fromEntries(r.nodes.map((n) => [n.id, n.batch])), esperado.batches, rotulo);
      }
    });
  }
}

test('equivalência v1.1: as sessões das fixtures antigas são exatamente as do golden', () => {
  for (const [nome, sessoes] of Object.entries(GOLDEN)) {
    const m = buildModel(fixture(nome));
    assert.deepEqual(m.sessions.map((s) => s.session_id).sort(), Object.keys(sessoes).sort(), nome);
  }
});
