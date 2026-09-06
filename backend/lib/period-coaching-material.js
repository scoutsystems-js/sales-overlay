'use strict';
const {loadKbMaterial}=require('./kb-material');
const MAX_CHARS=25000;
async function loadPeriodMaterial(admin,opts={}) {
 const material=await loadKbMaterial(admin,{...opts,lane:'rep-period',maxChars:MAX_CHARS,sellingOptions:{completeScript:true}});
 const script=(material.sources||[]).find(s=>s.label==='script');
 if(script && script.chunks_used<script.chunks_total)throw Error('Complete team script exceeds the coaching context budget');
 return material;
}
module.exports={loadPeriodMaterial,MAX_CHARS};
