<<<<<<<< HEAD:frontend/dist/assets/oi-profile-BJq_IgVz.js
import{w as a}from"./index-DP4d9Dh2.js";const t={getProfileData:async e=>(await a.post("/oiprofile/api/profile-data",e)).data,getIntervals:async()=>(await a.get("/oiprofile/api/intervals")).data,getUnderlyings:async e=>(await a.get(`/search/api/underlyings?exchange=${e}`)).data,getExpiries:async(e,s)=>(await a.get(`/search/api/expiries?exchange=${e}&underlying=${s}`)).data};export{t as o};
========
import{w as a}from"./index-ls1N6FaR.js";const t={getProfileData:async e=>(await a.post("/oiprofile/api/profile-data",e)).data,getIntervals:async()=>(await a.get("/oiprofile/api/intervals")).data,getUnderlyings:async e=>(await a.get(`/search/api/underlyings?exchange=${e}`)).data,getExpiries:async(e,s)=>(await a.get(`/search/api/expiries?exchange=${e}&underlying=${s}`)).data};export{t as o};
>>>>>>>> 81a4b12f4e096c669669668bb6218dc4e07a5a16:frontend/dist/assets/oi-profile-CJ5nVz3S.js
