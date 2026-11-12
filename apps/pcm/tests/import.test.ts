import test from 'node:test';
import assert from 'node:assert/strict';
import {ImportService} from '../lib/import-service';
import type {PrivateStore} from '../lib/storage';
import {fixture} from './fixture';

function memoryStore(){const files=new Map<string,Buffer>();const store:PrivateStore={async put(key,bytes){files.set(key,Buffer.from(bytes));},async get(key){return files.get(key)!;},async remove(key){files.delete(key);}};return {store,files};}
test('staging review, partial confirmation, idempotency, safe conflicts and permission boundaries',async()=>{
 const f=await fixture();try{
  const {store,files}=memoryStore();const service=new ImportService(f.db,store);
  const bytes=Buffer.from('ITEM;DESCRIÇÃO;FORNECEDOR;UNID. MEDIDA;VALOR UNITÁRIO;LEAD TIME\n0000786;Peça sintética;Teste;PC;0,10;1,5\n0000787;Outra peça;Teste;PC;2,00;');
  await assert.rejects(()=>service.preview(f.requester,{unit_id:f.unit.id,filename:'LISTA DE PEÇAS.csv'},bytes),/Permissão/);
  let b=await service.preview(f.admin,{unit_id:f.unit.id,filename:'LISTA DE PEÇAS.csv'},bytes);assert.equal(b.counts.pending,2);assert.equal(b.counts.applied,0);assert.equal(files.size,1);assert.equal(b.storage_key,undefined);assert.equal((await service.batches(f.admin)).rows[0].storage_key,undefined);
  await assert.rejects(()=>service.batch(f.outsider,b.id),/Permissão|escopo/);
  const reused=await service.preview(f.admin,{unit_id:f.unit.id,filename:'renamed.csv'},bytes);assert.equal(reused.id,b.id);assert.equal(reused.reused,true);assert.equal(files.size,1);
  const first=b.rows.find(r=>r.proposed_values.code==='0000786')!;b=await service.review(f.admin,b.id,{line_id:first.id,status:'APPROVED',reason:'Lead time mantido apenas como referência.',revision:b.revision});
  await assert.rejects(()=>service.review(f.admin,b.id,{line_id:first.id,status:'REJECTED',revision:1}),/outra sessão/);
  b=await service.confirm(f.admin,b.id,{revision:b.revision});assert.equal(b.counts.applied,1);assert.equal(b.counts.pending,1);assert.equal(b.status,'PARTIAL');
  const material=(await f.db.query('SELECT * FROM pcm.materials WHERE code=$1',['0000786'])).rows[0];assert.equal(String(material.unit_cost),'0.100000');
  const second=b.rows.find(r=>r.proposed_values.code==='0000787')!;b=await service.review(f.admin,b.id,{line_id:second.id,status:'REJECTED',reason:'Não será incorporado agora.',revision:b.revision});b=await service.confirm(f.admin,b.id,{revision:b.revision});
  assert.equal(b.status,'CONFIRMED');await service.confirm(f.admin,b.id,{revision:b.revision});assert.equal((await f.db.query('SELECT count(*)::int AS n FROM pcm.materials')).rows[0].n,1);
  await assert.rejects(()=>service.review(f.admin,b.id,{line_id:first.id,status:'REJECTED',revision:b.revision}),/já aplicada/);
  const conflict=Buffer.from('ITEM;DESCRIÇÃO;FORNECEDOR;UNID. MEDIDA\n0000786;Nome conflitante;Teste;PC');let c=await service.preview(f.admin,{unit_id:f.unit.id,filename:'LISTA DE PEÇAS.csv'},conflict);c=await service.review(f.admin,c.id,{line_id:c.rows[0].id,status:'APPROVED',revision:c.revision,reason:'Revisão sintética de conflito.'});await assert.rejects(()=>service.confirm(f.admin,c.id,{revision:c.revision}),/Conflito/);assert.equal((await f.db.query('SELECT name FROM pcm.materials WHERE id=$1',[material.id])).rows[0].name,'Peça sintética');
  c=await service.review(f.admin,c.id,{line_id:c.rows[0].id,status:'APPROVED',revision:c.revision,values:{overwrite_existing:true},reason:'Atualização explicitamente autorizada.'});await service.confirm(f.admin,c.id,{revision:c.revision});assert.equal((await f.db.query('SELECT name FROM pcm.materials WHERE id=$1',[material.id])).rows[0].name,'Nome conflitante');
  const csv=await service.report(f.admin,b.id);assert.ok(csv.includes('0000786'));await assert.rejects(()=>service.report(f.auditor,b.id),/manutenção/);
  const another=await service.preview(f.admin,{unit_id:f.otherUnit.id,filename:'LISTA DE PEÇAS.csv'},bytes);assert.notEqual(another.id,b.id);
 }finally{await f.pg.close();}
});
test('movement files preserve equal legitimate events and flag overlap; snapshots stay separate',async()=>{
 const f=await fixture();try{
  const {store}=memoryStore();const service=new ImportService(f.db,store);
  const bytes=Buffer.from('Cod Item;Data Trans;Esp;Quantidade;Un;Documento\n00001;02/01/2026;REQ;2;PC;0000123\n00001;02/01/2026;REQ;2;PC;0000123');
  let b=await service.preview(f.admin,{unit_id:f.unit.id,filename:'CE0302.csv'},bytes);assert.equal(b.counts.pending,2);
  for(const row of b.rows)b=await service.review(f.admin,b.id,{line_id:row.id,status:'APPROVED',reason:'Apenas movimentação externa sem consumo PCM.',revision:b.revision});
  b=await service.confirm(f.admin,b.id,{revision:b.revision});assert.equal(b.counts.applied,2);
  let c=await service.preview(f.admin,{unit_id:f.unit.id,filename:'CE0302.csv'},Buffer.from(bytes.toString()+'\n'));
  assert.equal(c.counts.pending,2);assert.ok(c.rows.every(r=>r.issues.some((i:string)=>i.includes('sobreposição'))));
  for(const row of c.rows)c=await service.review(f.admin,c.id,{line_id:row.id,status:'APPROVED',reason:'Eventos legítimos preservados para conciliação.',revision:c.revision});await service.confirm(f.admin,c.id,{revision:c.revision});
  assert.equal((await f.db.query('SELECT count(*)::int AS n FROM pcm.imported_movements')).rows[0].n,4);
  let s=await service.preview(f.admin,{unit_id:f.unit.id,filename:'ESTOQUE.csv'},Buffer.from('Codigo;Descrição;Dep;Unidade;Quantidade\n00001;Peça;alm;PC;10'));
  s=await service.review(f.admin,s.id,{line_id:s.rows[0].id,status:'APPROVED',revision:s.revision});await service.confirm(f.admin,s.id,{revision:s.revision});
  assert.equal((await f.db.query('SELECT normalized_depot FROM pcm.stock_snapshots')).rows[0].normalized_depot,'ALM');assert.equal((await f.db.query('SELECT count(*)::int AS n FROM pcm.imported_movements')).rows[0].n,4);assert.equal((await f.db.query('SELECT count(*)::int AS n FROM pcm.order_materials')).rows[0].n,0);
  const stocks=await service.references(f.technician,'stock',{search:'00001',unit_id:f.unit.id});assert.equal(stocks.total,1);assert.equal(stocks.rows[0].quantity,'10.000000');assert.equal(stocks.rows[0].depot,'alm');assert.equal(stocks.rows[0].source_filename,'ESTOQUE.csv');assert.equal(stocks.rows[0].raw,undefined);assert.equal(stocks.rows[0].storage_key,undefined);
  assert.equal((await service.references(f.technician,'movements',{type:'MOVEMENT'})).total,4);assert.equal((await service.references(f.outsider,'stock')).total,0);await assert.rejects(()=>service.references(f.outsider,'stock',{unit_id:f.unit.id}),/escopo/);
 }finally{await f.pg.close();}
});
test('textual receipts require reviewed units and quantities; CSV reports neutralize formulas',async()=>{
 const f=await fixture();try{
  const {store}=memoryStore();const service=new ImportService(f.db,store);
  let b=await service.preview(f.admin,{unit_id:f.unit.id,filename:'Insumos Manu.Pintura-Jateamento.csv'},Buffer.from('ORDEM DE COMPRA;PEDIDO;CÓDIGO;DESCRIÇÃO;QTD;STATUS;QNT RECEBIDA\n119.16;000123;=1+1;Peça;5;CONFIRMADO;RECEBIDO 1 UN'));
  const line=b.rows[0];assert.equal(line.proposed_values.received_quantity,null);
  await assert.rejects(()=>service.review(f.admin,b.id,{line_id:line.id,status:'APPROVED',revision:b.revision,values:{unit:'PC',received_quantity:'1',received_unit:'UN'},reason:'Conferido recebimento parcial.'}),/Unidade recebida/);
  b=await service.review(f.admin,b.id,{line_id:line.id,status:'APPROVED',revision:b.revision,values:{unit:'UN',received_quantity:'1',received_unit:'UN'},reason:'Conferido recebimento parcial.'});await service.confirm(f.admin,b.id,{revision:b.revision});
  const purchase=(await f.db.query('SELECT * FROM pcm.purchase_lines')).rows[0];assert.equal(purchase.purchase_order,'119.16');assert.equal(purchase.order_number,'000123');assert.equal(String(purchase.received_quantity),'1.000000');assert.ok((await service.report(f.admin,b.id)).includes("' =1+1".replace(' ','')));const references=await service.references(f.technician,'purchases');assert.equal(references.total,1);assert.equal(references.rows[0].remaining_quantity,'4.000000');assert.equal(references.rows[0].source_kind,'PURCHASE');
 }finally{await f.pg.close();}
});
test('source approval is bounded, resumable, optimistic and cannot grant unit or cost access',async()=>{
 const f=await fixture();try{
  const {store}=memoryStore();const service=new ImportService(f.db,store);
  const csv='Cod Item;Data Trans;Esp;Quantidade;Un;Documento;Valor MAT\n'+Array.from({length:501},(_,i)=>`00001;02/01/2026;REQ;1;PC;${String(i).padStart(7,'0')};321,09`).join('\n');
  let b=await service.preview(f.admin,{unit_id:f.unit.id,filename:'CE0302.csv'},Buffer.from(csv));
  await assert.rejects(()=>service.review(f.admin,b.id,{selection:{kind:'MOVEMENT'},status:'APPROVED',revision:b.revision}),/motivo/);
  b=await service.review(f.admin,b.id,{selection:{kind:'MOVEMENT'},status:'APPROVED',reason:'Apenas preservar fonte externa.',revision:b.revision});assert.equal(b.reviewed_now,500);assert.equal(b.remaining_selection,1);
  const oldRevision=b.revision;b=await service.review(f.admin,b.id,{selection:{kind:'MOVEMENT'},status:'APPROVED',reason:'Apenas preservar fonte externa.',revision:b.revision});assert.equal(b.reviewed_now,1);assert.equal(b.remaining_selection,0);assert.equal(b.counts.approved,501);
  await assert.rejects(()=>service.confirm(f.admin,b.id,{revision:oldRevision}),/outra sessão/);
  b=await service.confirm(f.admin,b.id,{revision:b.revision});assert.equal(b.applied_now,500);assert.equal(b.counts.approved,1);assert.equal(b.status,'PARTIAL');b=await service.confirm(f.admin,b.id,{revision:b.revision});assert.equal(b.applied_now,1);assert.equal(b.status,'CONFIRMED');
  const publicReferences=await service.references(f.technician,'movements',{pageSize:1});assert.equal(publicReferences.rows[0].values.material_value,undefined);assert.equal(publicReferences.rows[0].raw,undefined);const privateReferences=await service.references(f.admin,'movements',{pageSize:1});assert.equal(privateReferences.rows[0].values.material_value,'321.09');
  await f.db.query("UPDATE pcm.memberships SET permissions='[\"imports.preview\",\"imports.confirm\",\"export\"]'::jsonb WHERE user_id=$1",[f.outsider.id]);
  await assert.rejects(()=>service.batch(f.outsider,b.id),/escopo/);await assert.rejects(()=>service.report(f.outsider,b.id),/escopo/);await assert.rejects(()=>service.preview(f.outsider,{unit_id:f.unit.id,filename:'CE0302.csv'},Buffer.from(csv)),/escopo/);
  const moneyBytes=Buffer.from('ITEM;DESCRIÇÃO;FORNECEDOR;UNID. MEDIDA;VALOR UNITÁRIO\n0000786;Peça;Teste;PC;1234,56');const costBatch=await service.preview(f.admin,{unit_id:f.unit.id,filename:'LISTA DE PEÇAS.csv'},moneyBytes);
  await f.db.query("UPDATE pcm.memberships SET permissions='[\"imports.preview\",\"imports.confirm\",\"export\"]'::jsonb WHERE user_id=$1",[f.technician.id]);
  const safe=await service.batch(f.technician,costBatch.id);assert.equal(safe.rows[0].raw,null);assert.equal(safe.rows[0].proposed_values.unit_cost,undefined);assert.ok(!(await service.report(f.technician,costBatch.id)).includes('1234.56'));
  await assert.rejects(()=>service.review(f.technician,costBatch.id,{line_id:safe.rows[0].id,status:'APPROVED',values:{unit_cost:'1'},revision:costBatch.revision}),/Permissão/);
  await f.db.query("UPDATE pcm.memberships SET permissions='[]'::jsonb WHERE user_id=$1",[f.technician.id]);await assert.rejects(()=>service.batch(f.technician,costBatch.id),/Permissão/);
 }finally{await f.pg.close();}
});
