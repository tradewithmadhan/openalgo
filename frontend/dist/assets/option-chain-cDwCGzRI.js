<<<<<<<< HEAD:frontend/dist/assets/option-chain-B0SCuFpQ.js
import{v as s}from"./index-B7HEz9uz.js";const r={getOptionChain:async(t,e,o,i,n)=>(await s.post("/optionchain",{apikey:t,underlying:e,exchange:o,expiry_date:i,strike_count:n??20})).data,getExpiries:async(t,e,o,i="options")=>(await s.post("/expiry",{apikey:t,symbol:e,exchange:o,instrumenttype:i})).data};export{r as o};
========
import{v as s}from"./index-D9ef9b6u.js";const r={getOptionChain:async(t,e,o,i,n)=>(await s.post("/optionchain",{apikey:t,underlying:e,exchange:o,expiry_date:i,strike_count:n??20})).data,getExpiries:async(t,e,o,i="options")=>(await s.post("/expiry",{apikey:t,symbol:e,exchange:o,instrumenttype:i})).data};export{r as o};
>>>>>>>> 4928561be68c6f9013071aadf6320811dc2e476e:frontend/dist/assets/option-chain-cDwCGzRI.js
