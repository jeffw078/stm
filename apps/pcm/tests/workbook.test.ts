import test from 'node:test';
import assert from 'node:assert/strict';
import {zipSync,strToU8} from 'fflate';
import {readWorkbook,mapWorkbook,excelDate,decimalValue,WORKBOOK_LIMITS} from '../lib/workbook';

export function syntheticWorkbook(sheetName:string,rows:string,date1904=false,extra:Record<string,string>={}){
 const files:Record<string,Uint8Array>={
  'xl/workbook.xml':strToU8(`<workbook><workbookPr date1904="${date1904?1:0}"/><sheets><sheet name="${sheetName}" sheetId="1" r:id="rId1"/></sheets></workbook>`),
  'xl/_rels/workbook.xml.rels':strToU8('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),
  'xl/worksheets/sheet1.xml':strToU8(`<worksheet><dimension ref="A1:AI1048576"/><sheetData>${rows}</sheetData></worksheet>`),
  'xl/styles.xml':strToU8('<styleSheet><numFmts><numFmt numFmtId="165" formatCode="0000000"/></numFmts><cellXfs><xf numFmtId="0"/><xf numFmtId="165"/><xf numFmtId="14"/></cellXfs></styleSheet>')
 };for(const [key,value]of Object.entries(extra))files[key]=strToU8(value);return Buffer.from(zipSync(files));
}
export const inline=(address:string,value:string)=>`<c r="${address}" t="inlineStr"><is><t>${value.replaceAll('&','&amp;').replaceAll('<','&lt;')}</t></is></c>`;
test('XLSX sparse preserves identifiers and skips the formula at row 1048576',()=>{
 const bytes=syntheticWorkbook('CE0302',`<row r="1">${inline('A1','Cod Item')}${inline('B1','Data Trans')}${inline('C1','Quantidade')}${inline('D1','Un')}${inline('E1','Documento')}${inline('F1','Esp')}</row><row r="2"><c r="A2" s="1"><v>786</v></c><c r="B2" s="2"><v>46024</v></c><c r="C2"><v>1.25</v></c>${inline('D2','PC')}${inline('E2','0000123')}${inline('F2','REQ')}</row><row r="1048576"><c r="D1048576"><f>WEBSERVICE("https://invalid.example")</f><v>9</v></c></row>`);
 const workbook=readWorkbook(bytes,'sparse.xlsx');assert.equal(workbook.sheets[0].rows.length,3);assert.equal(workbook.sheets[0].rows[2].number,1048576);
 const mapped=mapWorkbook(workbook);assert.equal(mapped.lines.length,1);assert.equal(mapped.sheets[0].ignored_rows,1);assert.equal(mapped.lines[0].values.code,'0000786');assert.equal(mapped.lines[0].values.document,'0000123');assert.equal(mapped.lines[0].values.quantity,'1.25');assert.equal(mapped.lines[0].values.source_date,'2026-01-02');assert.equal(mapped.lines[0].row,2);
});
test('Excel 1900/1904 and Brazilian decimal rules are precise',()=>{
 assert.equal(excelDate('1'),'1900-01-01');assert.equal(excelDate('59'),'1900-02-28');assert.equal(excelDate('60'),null);assert.equal(excelDate('61'),'1900-03-01');assert.equal(excelDate('0',true),'1904-01-01');
 assert.equal(decimalValue('1.234,56789'),'1234.56789');assert.equal(decimalValue('0,10'),'0.1');assert.equal(decimalValue('119.16','xml'),'119.16');assert.equal(decimalValue('NaN'),null);
 const bytes=syntheticWorkbook('CE0302',`<row r="1">${inline('A1','Cod Item')}${inline('B1','Data Trans')}</row><row r="2">${inline('A2','000001')}<c r="B2" s="2"><v>0</v></c></row>`,true);
 assert.equal(mapWorkbook(readWorkbook(bytes,'1904.xlsx')).lines[0].values.source_date,'1904-01-01');
});
test('formulas stay raw, duplicate catalogue codes require reconciliation, lead time has no implicit unit',()=>{
 const bytes=syntheticWorkbook('LISTA DE PEÇAS',`<row r="4">${inline('A4','ITEM')}${inline('B4','DESCRIÇÃO')}${inline('C4','UNID. MEDIDA')}${inline('D4','ESTOQUE')}${inline('E4','LEAD TIME')}${inline('F4','VALOR UNITÁRIO')}</row><row r="35">${inline('A35','9000786')}${inline('B35','Peça sintética')}${inline('C35','PC')}<c r="D35"><f>1+2</f><v>3</v></c><c r="E35"><v>1.5</v></c><c r="F35"><v>828.05290000000002</v></c></row><row r="118">${inline('A118','9000786')}${inline('B118','Peça sintética')}${inline('C118','PC')}</row>`);
 const lines=mapWorkbook(readWorkbook(bytes,'catalog.xlsx')).lines;assert.equal(lines.length,2);assert.ok(lines.every(l=>l.action==='RECONCILE'));assert.equal(lines[0].values.stock,null);assert.equal(lines[0].raw.D.formula,'1+2');assert.equal(lines[0].raw.D.raw,'3');assert.equal(lines[0].values.unit_cost,'828.0529');assert.ok(lines[0].issues.some(i=>i.includes('6 casas')));assert.ok(lines[0].issues.some(i=>i.includes('LEAD TIME sem unidade')));
});
test('purchase identifiers and received proposals stay distinct from accepted receipt',()=>{
 const book=readWorkbook(Buffer.from('ORDEM DE COMPRA;PEDIDO;CÓDIGO;DESCRIÇÃO;QTD;DATA DE SOLICITAÇÃO;STATUS;QNT RECEBIDA\n119.16;000123;0000786;Peça;5;01/02/2026;CONFIRMADO;RECEBIDO 1 UN\n120.18;000124;0000787;Outra;2;01/02/2026;NAO CONFIRMADA;'),'Insumos Manu.Pintura-Jateamento.csv');
 const mapped=mapWorkbook(book);assert.equal(mapped.lines[0].values.purchase_order,'119.16');assert.equal(mapped.lines[0].values.order_number,'000123');assert.equal(mapped.lines[0].values.received_proposal,'1');assert.equal(mapped.lines[0].values.received_quantity,null);assert.equal(mapped.lines[1].values.received_quantity,null);assert.equal(mapped.lines[1].values.received_proposal,null);
});
test('ZIP expansion limits, XML entities and invalid formats are refused',()=>{
 assert.throws(()=>readWorkbook(Buffer.from('fake'),'bad.xlsx'));
 assert.throws(()=>readWorkbook(Buffer.alloc(WORKBOOK_LIMITS.bytes+1),'large.csv'),/12 MB/);
 assert.throws(()=>readWorkbook(syntheticWorkbook('X','',false,{'xl/sharedStrings.xml':'<!DOCTYPE x [<!ENTITY bomb "x">]><sst/>'}),'entities.xlsx'),/entidade/);
 const zip=zipSync({'xl/worksheets/bomb.xml':strToU8('x'.repeat(2*1024*1024))});assert.throws(()=>readWorkbook(zip,'bomb.xlsx'),/descompactação/);
});
