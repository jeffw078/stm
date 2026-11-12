import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {basename} from 'node:path';
import {ImportService} from '../lib/import-service';
import {hash} from '../lib/workbook';
import {fixture} from './fixture';

// Opt-in: the private workbook is never required by CI and never copied into artifacts.
test('real manut.xlsx: entire staging and resumable confirmation in an isolated database',{skip:!process.env.PCM_TEST_WORKBOOK,timeout:300000},async()=>{
 const path=process.env.PCM_TEST_WORKBOOK!;const bytes=readFileSync(path);const originalHash=hash(bytes);
 const files=new Map<string,Buffer>();const f=await fixture();try{
  const service=new ImportService(f.db,{async put(key,data){files.set(key,Buffer.from(data));},async get(key){return files.get(key)!;},async remove(key){files.delete(key);}});
  let batch=await service.preview(f.admin,{unit_id:f.unit.id,filename:basename(path)},bytes);
  const expected:Record<string,number>={'LISTA DE PEÇAS':124,'ESTOQUE':595,'BAIXAS':1103,'Insumos Manu.Pintura-Jateamento':46,'CE0302':21296,'TD_Analise':425,'VARIAVEIS':18};
  assert.equal(batch.total,23607);for(const sheet of batch.sheets)assert.equal(sheet.records,expected[sheet.name]);assert.equal(batch.counts.pending,23164);assert.equal(batch.counts.rejected,443);
  const duplicateRows=(await f.db.query("SELECT source_row FROM pcm.import_lines WHERE batch_id=$1 AND kind='CATALOG' AND proposed_values->>'code'='9000786' ORDER BY source_row",[batch.id])).rows;assert.deepEqual(duplicateRows.map(r=>r.source_row),[35,118]);
  assert.equal((await f.db.query('SELECT count(*)::int AS n FROM pcm.import_lines WHERE batch_id=$1 AND source_row=1048576',[batch.id])).rows[0].n,0);
  assert.equal((await f.db.query("SELECT proposed_values->>'purchase_order' AS n FROM pcm.import_lines WHERE batch_id=$1 AND kind='PURCHASE' ORDER BY source_row LIMIT 1",[batch.id])).rows[0].n,'119.16');
  console.log('REAL_WORKBOOK_STAGING '+JSON.stringify({bytes:bytes.length,sha256:originalHash,sheets:batch.sheets,counts:batch.counts}));
  // Apply all external events and snapshots through the same review/confirm service used by the UI.
  // Catalogue conflicts and receipt interpretations stay pending: no unreviewed business decisions.
  const candidates=(await f.db.query("SELECT id FROM pcm.import_lines WHERE batch_id=$1 AND kind IN ('STOCK','BAIXAS','MOVEMENT') ORDER BY sheet,source_row",[batch.id])).rows;
  for(let start=0;start<candidates.length;start+=500){batch=await service.review(f.admin,batch.id,{line_ids:candidates.slice(start,start+500).map(r=>r.id),status:'APPROVED',reason:'Validação descartável: preservar fontes externas sem reconhecer consumo PCM.',revision:batch.revision});}
  let requests=0;do{batch=await service.confirm(f.admin,batch.id,{revision:batch.revision});assert.ok(batch.applied_now<=500);requests++;}while(batch.counts.approved>0);
  assert.equal(batch.counts.applied,22994);assert.equal(batch.counts.pending,170);assert.equal(batch.status,'PARTIAL');
  assert.equal((await f.db.query('SELECT count(*)::int AS n FROM pcm.stock_snapshots')).rows[0].n,595);assert.equal((await f.db.query('SELECT count(*)::int AS n FROM pcm.imported_movements')).rows[0].n,22399);assert.equal((await f.db.query('SELECT count(*)::int AS n FROM pcm.order_materials')).rows[0].n,0);assert.equal((await f.db.query('SELECT count(*)::int AS n FROM pcm.orders')).rows[0].n,0);
  const reused=await service.preview(f.admin,{unit_id:f.unit.id,filename:basename(path)},bytes);assert.equal(reused.id,batch.id);assert.equal(reused.reused,true);assert.equal(reused.counts.applied,22994);assert.equal(files.size,1);
  assert.equal(hash(readFileSync(path)),originalHash);console.log('REAL_WORKBOOK_CONFIRM '+JSON.stringify({requests,counts:batch.counts,reused:reused.reused,original_unchanged:true}));
 }finally{await f.pg.close();files.clear();}
});
