<<<<<<<< HEAD:frontend/dist/assets/option-chain-B8nhiGVc.js
import{v as s}from"./index-Dydbvx-M.js";const r={getOptionChain:async(t,e,o,i,n)=>(await s.post("/optionchain",{apikey:t,underlying:e,exchange:o,expiry_date:i,strike_count:n??20})).data,getExpiries:async(t,e,o,i="options")=>(await s.post("/expiry",{apikey:t,symbol:e,exchange:o,instrumenttype:i})).data};export{r as o};
========
import{v as s}from"./index-Bat6d_-L.js";const r={getOptionChain:async(t,e,o,i,n)=>(await s.post("/optionchain",{apikey:t,underlying:e,exchange:o,expiry_date:i,strike_count:n??20})).data,getExpiries:async(t,e,o,i="options")=>(await s.post("/expiry",{apikey:t,symbol:e,exchange:o,instrumenttype:i})).data};export{r as o};
>>>>>>>> 7fb3b50b04e14e1d404e9adfc26b224a5781213c:frontend/dist/assets/option-chain-CNhN_2ic.js
