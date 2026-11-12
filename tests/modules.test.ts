import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canRead,canEdit,requireManager,assertTransition } from '../lib/domain';

const audit={auditor_id:'maintenance',status:'IN_PROGRESS',source:'LIVE'};
const maintenance:any={id:'maintenance',role:'USER',modules:{maintenance:{level:'ADMIN',sublevel:'MANAGER'}}};
const viewer:any={id:'maintenance',role:'USER',modules:{'5s':{level:'USER',sublevel:'VIEWER'}}};
const operator:any={id:'maintenance',role:'USER',modules:{'5s':{level:'USER',sublevel:'OPERATOR'}}};
const manager:any={id:'manager',role:'USER',modules:{'5s':{level:'USER',sublevel:'MANAGER'}}};

test('administração da manutenção não permite ler, editar ou revisar o 5S',()=>{
  assert.equal(canRead(maintenance,audit),false);
  assert.equal(canEdit(maintenance,audit),false);
  assert.throws(()=>requireManager(maintenance));
  assert.throws(()=>assertTransition('IN_PROGRESS','REVIEW',maintenance,'maintenance'));
});
test('consulta permite leitura sem edição mesmo para atividades atribuídas',()=>{
  assert.equal(canRead(viewer,audit),true);
  assert.equal(canEdit(viewer,audit),false);
  assert.throws(()=>requireManager(viewer));
  assert.throws(()=>assertTransition('IN_PROGRESS','REVIEW',viewer,'maintenance'));
});
test('operação permanece restrita às auditorias atribuídas',()=>{
  assert.equal(canRead(operator,audit),true);
  assert.equal(canEdit(operator,audit),true);
  assert.equal(canRead(operator,{...audit,auditor_id:'other'}),false);
  assert.throws(()=>requireManager(operator));
});
test('gestão do 5S permite revisão sem conceder administração global',()=>{
  assert.doesNotThrow(()=>requireManager(manager));
  assert.doesNotThrow(()=>assertTransition('REVIEW','FINALIZED',manager,'maintenance'));
});
test('revogar um módulo de um Admin legado remove o acesso ao 5S',()=>{
  const revoked:any={id:'old-admin',role:'ADMIN',modules:{}};
  assert.equal(canRead(revoked,audit),false);
  assert.throws(()=>requireManager(revoked));
});
