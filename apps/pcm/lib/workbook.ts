import {createHash} from 'node:crypto';
import {posix} from 'node:path';
import {unzipSync,strFromU8} from 'fflate';
import {XMLParser} from 'fast-xml-parser';
import {parse as csvParse} from 'csv-parse/sync';
import Decimal from 'decimal.js';
import {AppError,validDate} from '../../../lib/domain';

export const MAPPING_VERSION='pcm-2026-11-v1';
export const WORKBOOK_LIMITS={bytes:12*1024*1024,expanded:80*1024*1024,entry:40*1024*1024,entries:512,rows:100000,cells:1200000,ratio:250};
export type SourceCell={address:string;value:string;raw:string;type:string;formula?:string;date?:string;format?:string};
export type SourceRow={number:number;cells:Record<string,SourceCell>};
export type SourceSheet={name:string;hidden:boolean;rows:SourceRow[]};
export type Workbook={sheets:SourceSheet[];dateSystem:'1900'|'1904';warnings:string[]};
export type ImportKind='CATALOG'|'STOCK'|'BAIXAS'|'MOVEMENT'|'PURCHASE'|'AUXILIARY'|'UNKNOWN';
export type MappedLine={sheet:string;row:number;kind:ImportKind;raw:Record<string,SourceCell>;values:Record<string,any>;issues:string[];action:string;fingerprint:string};
export const normalized=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]/g,'');
const many=(v:any):any[]=>v===undefined?[]:Array.isArray(v)?v:[v];
const text=(v:any):string=>v===undefined?'':typeof v==='object'?String(v['#text']??''):String(v);
const richText=(v:any):string=>v===undefined?'':typeof v==='string'?v:many(v.t).map(text).join('')+many(v.r).map((r:any)=>richText(r)).join('');
const xmlParser=new XMLParser({ignoreAttributes:false,parseTagValue:false,parseAttributeValue:false,trimValues:false,processEntities:true});
function xml(data:Uint8Array){const s=strFromU8(data);if(/<!\s*(DOCTYPE|ENTITY)/i.test(s))throw new AppError('XML com declaração de entidade não é permitido.');return xmlParser.parse(s);}
export function excelDate(serial:string,date1904=false):string|null{
 if(!/^-?\d+(\.\d+)?$/.test(serial))return null;
 const days=new Decimal(serial).floor().toNumber();if(!Number.isSafeInteger(days)||days<0||(!date1904&&days===60))return null;
 const date=new Date(Date.UTC(date1904?1904:1899,date1904?0:11,date1904?1:31)+(days-(!date1904&&days>60?1:0))*86400000);
 if(!Number.isFinite(date.getTime()))return null;const result=date.toISOString().slice(0,10);return /^\d{4}-/.test(result)&&validDate(result)?result:null;
}
export function sourceDate(value:string,dateSystem:'1900'|'1904'='1900'):string|null{
 const s=value.trim();if(validDate(s))return s;const br=/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/.exec(s);
 if(br){const iso=`${br[3]}-${br[2].padStart(2,'0')}-${br[1].padStart(2,'0')}`;return validDate(iso)?iso:null;}
 return /^\d+(\.\d+)?$/.test(s)?excelDate(s,dateSystem==='1904'):null;
}
/** Locale is explicit for XLSX numeric cells; CSV follows Brazilian decimal notation. */
export function decimalValue(input:string,locale:'br'|'xml'='br'):string|null{
 let s=input.trim().replace(/^R\$\s*/i,'').replace(/\s/g,'');if(!s)return null;
 if(locale==='br'){if(s.includes(',')){if(!/^-?(\d{1,3}(\.\d{3})*|\d+),\d+$/.test(s))return null;s=s.replaceAll('.','').replace(',','.');}else if(/^-?\d{1,3}(\.\d{3})+$/.test(s))s=s.replaceAll('.','');}
 if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?$/.test(s)||s.length>100)return null;
 try{const n=new Decimal(s);if(!n.isFinite()||n.abs().gte('100000000000000')||n.decimalPlaces()>6)return null;return n.toFixed();}catch{return null;}
}
function isDateFormat(id:number,format:string){return (id>=14&&id<=22)||(id>=27&&id<=36)||(id>=45&&id<=47)||(id>=50&&id<=58)||/[yd]/i.test(format.replace(/"[^"]*"|\\.|\[[^\]]*\]/g,''));}
export function readWorkbook(bytes:Uint8Array,filename:string):Workbook{
 if(!bytes.length||bytes.length>WORKBOOK_LIMITS.bytes)throw new AppError('Arquivo vazio ou maior que 12 MB.');
 if(/\.csv$/i.test(filename))return readCsv(bytes,filename);
 if(!/\.xlsx$/i.test(filename)||bytes[0]!==0x50||bytes[1]!==0x4b)throw new AppError('Envie um arquivo XLSX ou CSV válido.');
 const seen=new Set<string>();let count=0,total=0;
 let files:Record<string,Uint8Array>;
 try{files=unzipSync(bytes,{filter(info){
  if(++count>WORKBOOK_LIMITS.entries||seen.has(info.name)||info.name.includes('\\')||info.name.startsWith('/')||info.name.split('/').includes('..'))throw new AppError('Estrutura ZIP inválida.');seen.add(info.name);
  total+=info.originalSize;
  if(info.originalSize>WORKBOOK_LIMITS.entry||total>WORKBOOK_LIMITS.expanded||info.originalSize>Math.max(1024*1024,info.size*WORKBOOK_LIMITS.ratio))throw new AppError('Limite de descompactação excedido.');
  return /^(xl\/workbook\.xml|xl\/_rels\/workbook\.xml\.rels|xl\/sharedStrings\.xml|xl\/styles\.xml|xl\/worksheets\/[^/]+\.xml)$/.test(info.name);
 }});}catch(e){if(e instanceof AppError)throw e;throw new AppError('XLSX inválido ou descompactação recusada.');}
 if(!files['xl/workbook.xml']||!files['xl/_rels/workbook.xml.rels'])throw new AppError('Estrutura de workbook ausente.');
 const book=xml(files['xl/workbook.xml']).workbook;const dateSystem=book?.workbookPr?.['@_date1904']==='1'||book?.workbookPr?.['@_date1904']==='true'?'1904':'1900';
 const rels=new Map<string,string>();for(const r of many(xml(files['xl/_rels/workbook.xml.rels']).Relationships?.Relationship)){
  if(r['@_TargetMode']==='External')continue;const target=String(r['@_Target']??'');const path=target.startsWith('/')?target.slice(1):posix.normalize('xl/'+target);
  if(path.startsWith('xl/worksheets/'))rels.set(r['@_Id'],path);
 }
 const strings=files['xl/sharedStrings.xml']?many(xml(files['xl/sharedStrings.xml']).sst?.si).map(richText):[];
 const styles=files['xl/styles.xml']?xml(files['xl/styles.xml']).styleSheet:{};
 const numFormats=new Map<number,string>(many(styles?.numFmts?.numFmt).map(f=>[Number(f['@_numFmtId']),f['@_formatCode']]));
 const xfs=many(styles?.cellXfs?.xf);let cellCount=0,rowCount=0;const sheets:SourceSheet[]=[];const warnings=['Fórmulas, macros e links externos nunca são executados.'];
 for(const s of many(book?.sheets?.sheet)){
  const path=rels.get(s['@_r:id']);if(!path||!files[path])throw new AppError('Relação de aba inválida ou externa.');
  const sourceRows=many(xml(files[path]).worksheet?.sheetData?.row);const rows:SourceRow[]=[];const usedRows=new Set<number>();
  for(const r of sourceRows){
   const number=Number(r['@_r']);if(!Number.isInteger(number)||number<1||number>1048576||usedRows.has(number))throw new AppError('Número de linha inválido ou repetido.');usedRows.add(number);
   const cells:Record<string,SourceCell>={};
   for(const c of many(r.c)){
    if(++cellCount>WORKBOOK_LIMITS.cells)throw new AppError('Limite de células excedido.');
    const address=String(c['@_r']??'');const match=/^([A-Z]{1,3})(\d+)$/.exec(address);if(!match||Number(match[2])!==number||cells[match[1]])throw new AppError('Endereço de célula inválido ou repetido.');
    const type=String(c['@_t']??'n');const raw=text(c.v);const styleId=Number(c['@_s']??0);const formatId=Number(xfs[styleId]?.['@_numFmtId']??0);const format=numFormats.get(formatId)??'';
    let value=type==='s'?strings[Number(raw)]??'':type==='inlineStr'?richText(c.is):raw;
    if(type==='n'&&/^0+$/.test(format)&&/^\d+$/.test(raw))value=raw.padStart(format.length,'0');
    const cell:SourceCell={address,value,raw,type,format};if(c.f!==undefined)cell.formula=text(c.f);
    if(type==='n'&&isDateFormat(formatId,format))cell.date=excelDate(raw,dateSystem==='1904')??undefined;
    if(value!==''||cell.formula!==undefined)cells[match[1]]=cell;
   }
   if(Object.keys(cells).length){if(++rowCount>WORKBOOK_LIMITS.rows)throw new AppError('Limite de linhas efetivas excedido.');rows.push({number,cells});}
  }
  sheets.push({name:String(s['@_name']),hidden:s['@_state']==='hidden'||s['@_state']==='veryHidden',rows:rows.sort((a,b)=>a.number-b.number)});
 }
 return {sheets,dateSystem,warnings};
}
function column(index:number){let s='';for(let n=index+1;n;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s;}
function readCsv(bytes:Uint8Array,filename:string):Workbook{
 const content=new TextDecoder('utf-8',{fatal:true}).decode(bytes).replace(/^\uFEFF/,'');if(content.includes('\0'))throw new AppError('CSV contém conteúdo binário.');
 const first=content.split(/\r?\n/).slice(0,8).join('\n');const delimiter=[';',',','\t'].sort((a,b)=>first.split(b).length-first.split(a).length)[0];let records:string[][];
 try{records=csvParse(content,{delimiter,relax_column_count:true,skip_empty_lines:false,max_record_size:1024*1024});}catch{throw new AppError('CSV inválido. Use UTF-8 com separador vírgula, ponto e vírgula ou tabulação.');}
 if(records.length>WORKBOOK_LIMITS.rows)throw new AppError('Limite de linhas CSV excedido.');let count=0;
 const rows=records.flatMap((record,idx)=>{const cells:Record<string,SourceCell>={};record.forEach((value,i)=>{if(++count>WORKBOOK_LIMITS.cells)throw new AppError('Limite de células excedido.');if(value!=='')cells[column(i)]={address:column(i)+(idx+1),value,raw:value,type:'csv'};});return Object.keys(cells).length?[{number:idx+1,cells}]:[];});
 return {sheets:[{name:filename.replace(/\.csv$/i,''),hidden:false,rows}],dateSystem:'1900',warnings:['CSV interpretado em UTF-8; números textuais seguem notação brasileira.']};
}

const aliases:Record<string,string[]>={
 code:['CODIGO','CODITEM','CODITEM','CODITEM','ITEM'],name:['DESCRICAO','DESCITEM'],unit:['UNIDMEDIDA','UNDMEDIDA','UNIDADE','UN'],
 quantity:['QUANTIDADE','QTDE','QTD'],unit_cost:['VALORUNITARIO','PRMEDIO'],source_value:['VALOR','TOTAL','VALORTOTAL'],
 minimum_quantity:['ESTMIN'],safety_stock:['ESTOQUEDESEG'],supplier:['FORNECEDOR'],stock:['ESTOQUE'],open_orders:['OCABERTA'],planning_balance:['SALDO'],
 establishment:['ESTABEL','EST'],depot:['DEP'],lot:['LOTE'],location:['LOCALIZACAO','LOCALDEUSO'],cost_center:['CENTRODECUSTO','CENTROCUSTO','CC'],
 narrative:['NARRATIVA'],notes:['OBS'],lead_time:['LEADTIME'],date:['DATATRANS','DATADASOLICITACAO','DATADESOLICITACAO'],
 purchase_order:['ORDEMDECOMPRA','ORDEMCOMPRA'],request_number:['NDASOLICITACAO','NODASOLICITACAO','NUMERODASOLICITACAO'],order_number:['PEDIDO'],
 status:['STATUS'],received_text:['QNTRECEBIDA'],movement_type:['TIPO'],species:['ESP'],document:['DOCUMENTO'],material_value:['VALORMAT'],labor_value:['VALORMOB'],overhead_value:['VALORGGF']
};
const numericFields=new Set(['quantity','unit_cost','source_value','minimum_quantity','safety_stock','stock','open_orders','planning_balance','lead_time','material_value','labor_value','overhead_value']);
function knownKind(name:string):ImportKind{const n=normalized(name);return n==='LISTADEPECAS'?'CATALOG':n==='ESTOQUE'?'STOCK':n==='BAIXAS'?'BAIXAS':n==='CE0302'?'MOVEMENT':n==='INSUMOSMANUPINTURAJATEAMENTO'?'PURCHASE':['TDANALISE','VARIAVEIS'].includes(n)?'AUXILIARY':'UNKNOWN';}
function headerFields(row:SourceRow,kind:ImportKind){const fields:Record<string,string>={};for(const [col,c] of Object.entries(row.cells)){if(c.formula!==undefined)continue;const n=normalized(c.value);for(const [field,names] of Object.entries(aliases))if(names.includes(n))fields[field]=col;}
 // BAIXAS has both CÓD. ITEM and ITEM (description); ITEM alone denotes catalogue code.
 if(kind==='BAIXAS'){for(const [col,c] of Object.entries(row.cells)){if(normalized(c.value)==='CODITEM')fields.code=col;if(normalized(c.value)==='ITEM')fields.name=col;}}
 return fields;}
function inferredKind(fields:Record<string,string>):ImportKind{return fields.purchase_order&&fields.received_text?'PURCHASE':fields.species&&fields.date?'MOVEMENT':fields.depot&&fields.quantity?'STOCK':fields.request_number?'BAIXAS':fields.minimum_quantity||fields.supplier||fields.code&&fields.name&&fields.unit?'CATALOG':'UNKNOWN';}
export function mapWorkbook(book:Workbook){
 const lines:MappedLine[]=[];const sheets:any[]=[];const warnings=[...book.warnings];
 for(const sheet of book.sheets){
  let kind=knownKind(sheet.name);let header:SourceRow|undefined,fields:Record<string,string>={};
  if(kind!=='AUXILIARY')for(const row of sheet.rows.slice(0,50)){
   const candidate=headerFields(row,kind);if(candidate.code&&Object.keys(candidate).length>=2){header=row;fields=candidate;if(kind==='UNKNOWN')kind=inferredKind(candidate);break;}
  }
  if(kind==='UNKNOWN'||kind!=='AUXILIARY'&&!header){warnings.push(`Aba ${sheet.name}: cabeçalho ou mapeamento não reconhecido; nenhum registro aplicado.`);}
  let ignored=0,count=0;
  for(const row of sheet.rows){
   if(header&&row.number<=header.number)continue;
   if(kind==='AUXILIARY'||kind==='UNKNOWN'){
    lines.push({sheet:sheet.name,row:row.number,kind,raw:row.cells,values:{},issues:[kind==='AUXILIARY'?'Fonte auxiliar: somente conferência/mapeamento.':'Mapeamento não reconhecido.'],action:'IGNORE',fingerprint:hash(JSON.stringify(row.cells))});count++;continue;
   }
   if(!header){ignored++;continue;}const identifier=row.cells[fields.code];
   if(!identifier||identifier.formula!==undefined||!identifier.value.trim()||/^(TOTAL|TOTAIS|CODIGO|CODITEM|ITEM)$/i.test(normalized(identifier.value))){ignored++;continue;}
   const values:Record<string,any>={code:identifier.value.trim(),source_date:null};const issues:string[]=[];
   for(const [field,col] of Object.entries(fields)){
    const c=row.cells[col];if(!c||!c.value.trim()){values[field]=null;continue;}
    if(c.formula!==undefined){values[field]=null;issues.push(`${field}: fórmula preservada apenas como referência; valor não aplicado.`);continue;}
    if(numericFields.has(field)){
     values[field]=decimalValue(c.raw,c.type==='n'?'xml':'br');
     if(values[field]===null&&c.type==='n'&&/^-?\d+(\.\d+)?$/.test(c.raw)&&c.raw.length<100){const n=new Decimal(c.raw);if(n.abs().lt('100000000000000')&&n.decimalPlaces()>6){values[field]=n.toDecimalPlaces(6).toFixed();issues.push(`${field}: arredondamento proposto para 6 casas decimais; valor XML original preservado para revisão.`);}}
     if(values[field]===null)issues.push(`${field}: decimal inválido ou fora da precisão suportada.`);
    }
    else if(field==='date'){values.source_date=c.date??sourceDate(c.value,book.dateSystem);if(!values.source_date)issues.push('Data inválida ou não informada.');}
    else values[field]=c.value.trim();
   }
   values.code=identifier.value.trim();if(values.depot)values.normalized_depot=values.depot.toUpperCase();
   if(!values.unit)issues.push('Unidade de medida não informada.');
   if(kind==='CATALOG'){if(!values.name)issues.push('Descrição não informada.');if(values.lead_time!==null&&values.lead_time!==undefined)issues.push('LEAD TIME sem unidade: não usado para calcular compra.');if(values.narrative||values.location)issues.push('Aplicação sugerida por narrativa/local: vínculo exige ativo validado e revisão.');}
   if(kind==='STOCK'&&values.quantity===null)issues.push('Quantidade de estoque não informada.');
   if(kind==='BAIXAS')issues.push('Significado ambíguo: solicitação/material; não é ordem nem consumo comprovado. Valor bruto sem natureza unitária/total confirmada.');
   if(kind==='MOVEMENT')issues.push('Movimentação importada sem mapeamento validado de espécie/sentido/estorno; não é consumo PCM.');
   if(kind==='PURCHASE'){
    values.received_quantity=null;values.received_proposal=null;values.received_unit=null;
    const match=/^(?:RECEBIDO\s*)?(\d+(?:[,.]\d+)?)\s*([A-ZÀ-Ü.]+)?$/i.exec(values.received_text??'');
    if(match){values.received_proposal=decimalValue(match[1]);values.received_unit=match[2]?.toUpperCase()??null;issues.push('Recebimento textual: proposta exige revisão da quantidade e unidade.');}
    else if(values.received_text)issues.push('Recebimento textual não reconhecido.');
    else issues.push('Recebimento desconhecido (campo vazio não significa zero).');
   }
   const fingerprint=hash(JSON.stringify([kind,values]));lines.push({sheet:sheet.name,row:row.number,kind,raw:row.cells,values,issues,action:kind==='CATALOG'?'CREATE':'REFERENCE',fingerprint});count++;
  }
  sheets.push({name:sheet.name,hidden:sheet.hidden,kind,header_row:header?.number??null,existing_rows:sheet.rows.length,records:count,ignored_rows:ignored});
 }
 const catalogs=new Map<string,MappedLine[]>();for(const line of lines)if(line.kind==='CATALOG'){const key=normalized(line.values.code);catalogs.set(key,[...(catalogs.get(key)??[]),line]);}
 for(const group of catalogs.values())if(group.length>1)for(const line of group){line.action='RECONCILE';line.issues.push(`Código de catálogo repetido (${line.values.code}); conciliar as ${group.length} linhas antes de aplicar.`);}
 return {lines,sheets,warnings,mapping_version:MAPPING_VERSION};
}
export function hash(value:Uint8Array|string){return createHash('sha256').update(value).digest('hex');}
