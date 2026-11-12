import {test} from 'node:test';
import assert from 'node:assert/strict';
import {safeReturnTo} from '../../../lib/return-to';
test('QR preserva destino autenticado sem permitir redirecionamento externo',()=>{
 assert.equal(safeReturnTo('/pcm/ativos/asset-id'),'/pcm/ativos/asset-id');
 for(const value of ['//evil.test/pcm','https://evil.test/pcm','/pcm/../../login','/usuarios','/pcmevil'])assert.equal(safeReturnTo(value),'/modulos');
});
