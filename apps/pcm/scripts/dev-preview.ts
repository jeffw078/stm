/** Synthetic disposable preview only; no connection or import into production. */
process.env.PCM_PREVIEW='1';
void import('../../../scripts/dev-preview').catch(e=>{console.error('PCM preview failed:',e.code??e.name);process.exitCode=1;});
