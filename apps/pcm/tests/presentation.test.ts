import {test} from 'node:test';
import assert from 'node:assert/strict';
import {serializePcm,notificationHref} from '../lib/presentation';
import {csvCell} from '../lib/base';
test('datas civis preservam dia do PostgreSQL; instantes preservam fuso e notificações apontam ao alvo real',()=>{
 const date=new Date(2026,10,12,0,0,0),instant=new Date('2026-11-12T15:30:00Z');
 assert.deepEqual(serializePcm({acquired_on:date,created_at:instant,nested:[{source_date:date}]}),{acquired_on:'2026-11-12',created_at:'2026-11-12T15:30:00.000Z',nested:[{source_date:'2026-11-12'}]});
 assert.equal(notificationHref('ORDER_UPDATED','request-1'),'/pcm/solicitacoes/request-1');
 assert.equal(notificationHref('PREVENTIVE','order-1'),'/pcm/ordens/order-1');
 assert.equal(notificationHref('JOB_FAILED',null),'/pcm/configuracoes');
 assert.equal(csvCell('  =HYPERLINK("x")'),'"\'  =HYPERLINK(""x"")"');
});
