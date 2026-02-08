<<<<<<<< HEAD:frontend/dist/assets/option-chain-CPA2VVTN.js
import{v as s}from"./index-CgtRSbjf.js";const r={getOptionChain:async(t,e,o,i,n)=>(await s.post("/optionchain",{apikey:t,underlying:e,exchange:o,expiry_date:i,strike_count:n??20})).data,getExpiries:async(t,e,o,i="options")=>(await s.post("/expiry",{apikey:t,symbol:e,exchange:o,instrumenttype:i})).data};export{r as o};
========
import{v as s}from"./index-BdWlx98l.js";const r={getOptionChain:async(t,e,o,i,n)=>(await s.post("/optionchain",{apikey:t,underlying:e,exchange:o,expiry_date:i,strike_count:n??20})).data,getExpiries:async(t,e,o,i="options")=>(await s.post("/expiry",{apikey:t,symbol:e,exchange:o,instrumenttype:i})).data};export{r as o};
>>>>>>>> 3eff93877fe6f969e4c53d91e81bb4e1a9bf2e21:frontend/dist/assets/option-chain-BxuVfDPC.js
