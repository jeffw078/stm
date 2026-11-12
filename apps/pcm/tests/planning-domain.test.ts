import {test} from 'node:test';
import assert from 'node:assert/strict';
import {occurrenceDate,nextScheduledDate,unionIntervals,spanHours,intersectionHours,localInstant,localDate,operationalWindows} from '../lib/planning-domain';

test('calendário fixo mantém âncora de 31/janeiro e 29/fevereiro',()=>{
 assert.deepEqual([0,1,2,3].map(i=>occurrenceDate('2024-01-31','MONTH',1,i)),['2024-01-31','2024-02-29','2024-03-31','2024-04-30']);
 assert.deepEqual([0,1,2,3,4].map(i=>occurrenceDate('2024-02-29','YEAR',1,i)),['2024-02-29','2025-02-28','2026-02-28','2027-02-28','2028-02-29']);
 assert.equal(occurrenceDate('2026-12-25','WEEK',2,1),'2027-01-08');
 assert.equal(nextScheduledDate({start_date:'2024-01-31',frequency_unit:'MONTH',frequency_count:1},'2026-02-01'),'2026-02-28');
 assert.equal(nextScheduledDate({start_date:'2020-01-01',frequency_unit:'DAY',frequency_count:1},'2026-11-12'),'2026-11-12');
 assert.throws(()=>occurrenceDate('2026-02-31','MONTH',1,1));
});
test('fuso local, meia-noite e união de paradas abertas e sobrepostas',()=>{
 assert.equal(localInstant('2026-11-12','00:00','America/Sao_Paulo'),'2026-11-12T03:00:00.000Z');
 assert.equal(localDate('2026-11-12T02:59:59Z'),'2026-11-11');
 const spans=unionIntervals([{start:'2026-01-01T23:00Z',end:'2026-01-02T02:00Z'},{start:'2026-01-02T01:00Z',end:null}], '2026-01-02T00:00Z','2026-01-02T03:00Z');
 assert.equal(spanHours(spans),3);assert.equal(intersectionHours(spans,[[Date.parse('2026-01-02T01:30Z'),Date.parse('2026-01-02T02:30Z')]]),1);
 const windows=operationalWindows({weekly_windows:[{day:4,start:'22:00',end:'06:00'}],valid_from:'2026-01-01'},'2026-01-02T03:00Z','2026-01-02T09:00Z','America/Sao_Paulo');
 assert.equal(spanHours(windows),6);
});
