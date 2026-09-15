/* ════════════════════════════════════════════════════════════
   GESTÃO ACADÉMICA PRO — versão Supabase
   Substitui o antigo localStorage por um backend real (Postgres +
   Auth + Storage + Realtime no Supabase).
════════════════════════════════════════════════════════════ */

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const TAMANHO_MAX_FICHEIRO = 20 * 1024 * 1024; // 20MB por ficheiro

function esc(s){
  return (s==null?'':String(s)).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/* ════════════════════════════════════
   TEMA (preferência local de UI — não são dados académicos)
════════════════════════════════════ */
let _tema=localStorage.getItem('ga_tema')||'light';
function aplicarTema(t){
  document.documentElement.setAttribute('data-theme',t);
  const icon=document.getElementById('theme-icon');
  if(icon)icon.textContent=t==='dark'?'☀️':'🌙';
  localStorage.setItem('ga_tema',t);
  _tema=t;
}
function toggleTheme(){aplicarTema(_tema==='dark'?'light':'dark');}

/* ════════════════════════════════════
   AUTH
════════════════════════════════════ */
let currentUser=null;

function showTab(t){
  ['login','reg'].forEach(x=>{
    document.getElementById('form-'+x).style.display=t===x?'':'none';
    document.getElementById('tab-'+x).classList.toggle('active',t===x);
  });
  document.getElementById('form-recover').style.display='none';
  document.getElementById('auth-erro').textContent='';
  document.getElementById('reg-erro').textContent='';
}

function mostrarRecuperacao(){
  document.getElementById('form-login').style.display='none';
  document.getElementById('form-reg').style.display='none';
  document.getElementById('form-recover').style.display='';
  document.getElementById('recover-step1').style.display='';
  document.getElementById('recover-step2').style.display='none';
  document.getElementById('recover-erro').textContent='';
  document.getElementById('rec-email').value='';
  document.getElementById('rec-codigo').value='';
  document.getElementById('rec-nova').value='';
}
function voltarLogin(){
  document.getElementById('form-recover').style.display='none';
  showTab('login');
}
let _recoverEmail=null;
async function enviarCodigoRecuperacao(){
  const email=document.getElementById('rec-email').value.trim();
  const el=document.getElementById('recover-erro');el.textContent='';
  if(!email){el.textContent='Indica o teu email';return;}
  await sb.auth.resetPasswordForEmail(email);
  // Mensagem sempre igual, exista ou não a conta — evita confirmar a terceiros que email está registado.
  _recoverEmail=email;
  document.getElementById('recover-step1').style.display='none';
  document.getElementById('recover-step2').style.display='';
  el.textContent='Se esse email estiver registado, foi enviado um código de 6 dígitos.';
  el.style.color='var(--green)';
}
async function confirmarNovaSenha(){
  const codigo=document.getElementById('rec-codigo').value.trim();
  const novaSenha=document.getElementById('rec-nova').value;
  const el=document.getElementById('recover-erro');el.textContent='';el.style.color='';
  if(!codigo||!novaSenha){el.textContent='Preenche o código e a nova senha';return;}
  if(novaSenha.length<6){el.textContent='A senha deve ter pelo menos 6 caracteres';return;}
  const{data,error}=await sb.auth.verifyOtp({email:_recoverEmail,token:codigo,type:'recovery'});
  if(error){el.textContent='Código inválido ou expirado. Pede um novo código.';return;}
  const{error:updErr}=await sb.auth.updateUser({password:novaSenha});
  if(updErr){el.textContent='Erro ao definir nova senha: '+updErr.message;return;}
  _recoverEmail=null;
  document.getElementById('form-recover').style.display='none';
  await carregarPerfilEEntrar(data.user);
}

async function fazerLogin(){
  const email=document.getElementById('a-email').value.trim();
  const pwd=document.getElementById('a-pwd').value;
  const el=document.getElementById('auth-erro');el.textContent='';
  if(!email||!pwd){el.textContent='Preenche email e senha';return;}
  const {data,error}=await sb.auth.signInWithPassword({email,password:pwd});
  if(error){el.textContent='Email ou senha incorrectos';return;}
  await carregarPerfilEEntrar(data.user);
}

async function fazerRegisto(){
  const nome=document.getElementById('r-nome').value.trim();
  const num=document.getElementById('r-num').value.trim();
  const ano=document.getElementById('r-ano').value;
  const curso=document.getElementById('r-curso').value.trim();
  const email=document.getElementById('r-email').value.trim();
  const pwd=document.getElementById('r-pwd').value;
  const pwd2=document.getElementById('r-pwd2').value;
  const el=document.getElementById('reg-erro');el.textContent='';
  if(!nome||!num||!curso||!email||!pwd||!pwd2){el.textContent='Preenche todos os campos obrigatórios';return;}
  if(pwd.length<6){el.textContent='A senha deve ter pelo menos 6 caracteres';return;}
  if(pwd!==pwd2){el.textContent='As senhas não coincidem';return;}
  const {data,error}=await sb.auth.signUp({
    email,password:pwd,
    options:{data:{nome,numero:num,curso,ano:ano?parseInt(ano):null}}
  });
  if(error){
    el.textContent=/already registered|already exists/i.test(error.message)
      ?'Este email já está registado'
      :'Não foi possível criar a conta (verifica se o número de estudante já está em uso). '+error.message;
    return;
  }
  if(data.session){await carregarPerfilEEntrar(data.user);return;}
  alert('Conta criada! Verifica o teu email para confirmares a conta e depois faz login.');
  showTab('login');
  document.getElementById('a-email').value=email;
}

async function carregarPerfilEEntrar(user){
  const {data:perfil,error}=await sb.from('profiles').select('*').eq('id',user.id).single();
  if(error||!perfil){
    await sb.auth.signOut();
    const el=document.getElementById('auth-erro');
    if(el)el.textContent='Não foi possível carregar o teu perfil. Tenta novamente.';
    return;
  }
  currentUser={id:perfil.id,nome:perfil.nome,numero:perfil.numero,curso:perfil.curso,ano:perfil.ano,email:user.email};
  await entrarNaApp();
}

async function logout(){
  if(_msgChannel){sb.removeChannel(_msgChannel);_msgChannel=null;}
  if(_geralChannel){sb.removeChannel(_geralChannel);_geralChannel=null;}
  await sb.auth.signOut();
  currentUser=null;
  Object.assign(S,{
    semestres:[],activeSem:null,activeDisc:null,vista:'notas',horarioSemana:[],
    materiais:[],matSearch:'',matDisc:null,lembretes:[],metas:[],apontamentos:[],matTab:'ficheiros',
    conversas:[],activeConversa:null,mensagens:[],comuTab:'pesquisar',comuQuery:'',comuResultados:[],_comuInit:false
  });
  document.getElementById('main-screen').style.display='none';
  document.getElementById('auth-screen').style.display='';
}

async function entrarNaApp(){
  document.getElementById('auth-screen').style.display='none';
  document.getElementById('main-screen').style.display='';
  document.getElementById('nav-nome').textContent=currentUser.nome;
  aplicarTema(_tema);
  await carregarDados();
  carregarConversas().then(atualizarBadgeComunidade);
  subscribeGeral();
}

/* ════════════════════════════════════
   ESTADO
════════════════════════════════════ */
const S={
  semestres:[],activeSem:null,activeDisc:null,vista:'notas',horarioSemana:[],modal:null,mdata:{},
  materiais:[],matSearch:'',matDisc:null,lembretes:[],metas:[],apontamentos:[],matTab:'ficheiros',
  conversas:[],activeConversa:null,mensagens:[],comuTab:'pesquisar',comuQuery:'',comuResultados:[],_comuInit:false
};

async function carregarDados(){
  const uid=currentUser.id;
  const {data:sems}=await sb.from('semestres').select('*').eq('user_id',uid)
    .order('ano',{ascending:false}).order('numero',{ascending:false});
  const semList=sems||[];
  const semIds=semList.map(s=>s.id);

  let discs=[];
  if(semIds.length){const r=await sb.from('disciplinas').select('*').in('semestre_id',semIds).order('id');discs=r.data||[];}
  const discIds=discs.map(d=>d.id);

  let horarios=[];
  if(discIds.length){const r=await sb.from('horarios').select('*').in('disciplina_id',discIds);horarios=r.data||[];}

  const [{data:mats},{data:lembs},{data:metas},{data:apts}]=await Promise.all([
    sb.from('materiais').select('*').eq('user_id',uid),
    sb.from('lembretes').select('*').eq('user_id',uid),
    sb.from('metas').select('*').eq('user_id',uid),
    sb.from('apontamentos').select('*').eq('user_id',uid)
  ]);

  S.semestres=semList.map(s=>({...s,disciplinas:discs.filter(d=>d.semestre_id===s.id).map(d=>({...d,estado:calcEstado(d)}))}));
  if(S.semestres.length&&!S.activeSem)S.activeSem=S.semestres[0].id;
  S.horarioSemana=horarios.map(h=>{
    const disc=discs.find(d=>d.id===h.disciplina_id);
    return{...h,disc_nome:disc?.nome||'?',docente:disc?.docente||''};
  });
  S.materiais=mats||[];
  S.lembretes=lembs||[];
  S.metas=metas||[];
  S.apontamentos=apts||[];
  render();
}

/* ════════════════════════════════════
   LÓGICA (pura — inalterada em relação à versão original)
════════════════════════════════════ */
function calcFreq(d){
  if(d.teste1==null||d.teste2==null||d.trabalho==null)return null;
  return +((d.teste1+d.teste2)/2*0.6+d.trabalho*0.4).toFixed(2);
}
function calcEstado(d){
  const f=calcFreq(d);
  if(f==null)return 'frequencia';
  if(f>=9.5){if(d.nota_exame!=null)return d.nota_exame>=9?'aprovado':'reprovado_exame';return'aprovado_freq';}
  if(d.nota_exame!=null)return d.nota_exame>=9?'aprovado':'reprovado';
  return'exame_pendente';
}
function estadoBadge(e){
  return({frequencia:{txt:'Em Frequência',cls:'pendente'},aprovado_freq:{txt:'Aprovado (Freq.)',cls:'aprovado'},exame_pendente:{txt:'Exame Pendente',cls:'exame'},aprovado:{txt:'Aprovado ✓',cls:'aprovado'},reprovado:{txt:'Reprovado ✗',cls:'reprovado'},reprovado_exame:{txt:'Reprov. no Exame',cls:'reprovado'}}[e]||{txt:e,cls:'pendente'});
}
function calcRisco(d){
  if(d.estado==='aprovado'||d.estado==='aprovado_freq')return 0;
  if(d.estado==='reprovado'||d.estado==='reprovado_exame')return 100;
  let risco=0;
  const notasPresentes=[d.teste1,d.teste2,d.trabalho].filter(x=>x!=null);
  const totalNotas=notasPresentes.length;
  if(totalNotas===0){risco=40;}
  else{
    const media=notasPresentes.reduce((a,b)=>a+b,0)/totalNotas;
    if(media<8)risco=85;else if(media<9.5)risco=60;else if(media<11)risco=30;else if(media<13)risco=15;else risco=5;
    const emFalta=3-totalNotas;
    if(emFalta>0&&media<12)risco=Math.min(100,risco+(emFalta*8));
  }
  const f=calcFreq(d);
  if(f!=null){if(f<8)risco=Math.max(risco,80);else if(f<9.5)risco=Math.max(risco,55);}
  return Math.round(risco);
}
function nivelRisco(r){
  if(r>=65)return{nivel:'alto',txt:'Alta',cls:'risco-alto',icon:'🔴'};
  if(r>=35)return{nivel:'medio',txt:'Média',cls:'risco-medio',icon:'🟡'};
  return{nivel:'baixo',txt:'Baixa',cls:'risco-baixo',icon:'🟢'};
}
function sugestaoRecuperacao(d){
  if(d.estado==='aprovado'||d.estado==='aprovado_freq')return null;
  const msgs=[];
  const f=calcFreq(d);
  if(f!=null&&f<9.5)msgs.push(`faltam <strong>${(9.5-f).toFixed(1)} val.</strong> na frequência para evitar o exame`);
  if(d.estado==='exame_pendente')msgs.push(`precisas de pelo menos <strong>9 val.</strong> no exame`);
  return msgs.length>0?msgs:null;
}
function calcPassagem(sem){
  if(!sem)return null;
  const ds=sem.disciplinas;
  const aprovadas=ds.filter(d=>d.estado==='aprovado'||d.estado==='aprovado_freq');
  const reprovadas=ds.filter(d=>d.estado==='reprovado'||d.estado==='reprovado_exame');
  const pendentes=ds.filter(d=>d.estado==='frequencia'||d.estado==='exame_pendente');
  return{total:ds.length,aprovadas:aprovadas.length,naoAprov:reprovadas.length,pendentes:pendentes.length,passa:reprovadas.length<=3};
}

/* ── CALCULADORA DE NOTAS ── */
function calcNotaNecessaria(d,objetivo){
  const obj=parseFloat(objetivo);
  if(isNaN(obj)||obj<0||obj>20)return null;
  const t1=d.teste1,t2=d.teste2,tr=d.trabalho;
  const faltam=[t1==null?'Teste 1':null,t2==null?'Teste 2':null,tr==null?'Trabalho':null].filter(Boolean);
  if(faltam.length===0){return{tipo:'completo',freq:calcFreq(d)};}
  if(faltam.length===3){return{tipo:'muitos_em_falta',faltam};}
  if(tr==null&&t1!=null&&t2!=null){
    const mediaT=(t1+t2)/2;
    const trNec=(obj-mediaT*0.6)/0.4;
    return{tipo:'trabalho',val:+trNec.toFixed(2),label:'Trabalho',faltam};
  }
  if(t2==null&&t1!=null&&tr!=null){
    const t2Nec=(obj-tr*0.4)*2/0.6-t1;
    return{tipo:'teste',val:+t2Nec.toFixed(2),label:'Teste 2',faltam};
  }
  if(t1==null&&t2!=null&&tr!=null){
    const t1Nec=(obj-tr*0.4)*2/0.6-t2;
    return{tipo:'teste',val:+t1Nec.toFixed(2),label:'Teste 1',faltam};
  }
  return{tipo:'varios',faltam};
}

function initials(n){return(n||'').trim().split(/\s+/).slice(0,2).map(w=>w[0]?.toUpperCase()||'').join('');}

/* ── LEMBRETES ── */
function diasAte(dataStr){
  const hoje=new Date();hoje.setHours(0,0,0,0);
  const d=new Date(dataStr);d.setHours(0,0,0,0);
  return Math.round((d-hoje)/(1000*60*60*24));
}
function getLembretesProximos(){
  return S.lembretes.filter(l=>diasAte(l.data)>=0&&diasAte(l.data)<=14)
    .sort((a,b)=>new Date(a.data)-new Date(b.data));
}

/* ── CONFLITOS HORÁRIO ── */
function detectarConflitos(horarios){
  const c=new Set();
  for(let i=0;i<horarios.length;i++)for(let j=i+1;j<horarios.length;j++){
    const a=horarios[i],b=horarios[j];
    if(a.dia_semana===b.dia_semana&&a.hora_inicio<b.hora_fim&&b.hora_inicio<a.hora_fim){c.add(a.id);c.add(b.id);}
  }
  return c;
}

/* ════════════════════════════════════
   ACÇÕES — SEMESTRES / DISCIPLINAS / NOTAS
════════════════════════════════════ */
async function addSemestre(){
  const ano=parseInt(document.getElementById('m-ano').value);
  const num=parseInt(document.getElementById('m-sem').value);
  if(!ano)return;
  const{data,error}=await sb.from('semestres').insert({user_id:currentUser.id,ano,numero:num}).select().single();
  if(error){alert('Erro ao adicionar semestre: '+error.message);return;}
  S.semestres.unshift({...data,disciplinas:[]});
  S.semestres.sort((a,b)=>b.ano-a.ano||b.numero-a.numero);
  S.activeSem=data.id;
  fecharModal();render();
}

async function removerSemestre(id){
  const sem=S.semestres.find(s=>s.id===id);if(!sem)return;
  const temNotas=sem.disciplinas.some(d=>d.teste1!=null||d.teste2!=null||d.trabalho!=null||d.nota_exame!=null);
  if(temNotas){
    const conf=prompt('⚠️ Este semestre tem notas lançadas. Apagar remove PERMANENTEMENTE todas as disciplinas, notas, horários e planos deste semestre.\n\nEscreve APAGAR para confirmares:');
    if(conf!=='APAGAR')return;
  }else{
    if(!confirm('Remover este semestre e todas as suas disciplinas?'))return;
  }
  const{error}=await sb.from('semestres').delete().eq('id',id);
  if(error){alert('Erro ao remover semestre: '+error.message);return;}
  const discIdsRemovidas=sem.disciplinas.map(d=>d.id);
  S.semestres=S.semestres.filter(s=>s.id!==id);
  S.horarioSemana=S.horarioSemana.filter(h=>!discIdsRemovidas.includes(h.disciplina_id));
  S.metas=S.metas.filter(m=>!discIdsRemovidas.includes(m.disciplina_id));
  S.materiais.forEach(m=>{if(discIdsRemovidas.includes(m.disciplina_id))m.disciplina_id=null;});
  S.lembretes.forEach(l=>{if(discIdsRemovidas.includes(l.disciplina_id))l.disciplina_id=null;});
  S.apontamentos.forEach(a=>{if(discIdsRemovidas.includes(a.disciplina_id))a.disciplina_id=null;});
  if(S.activeSem===id){S.activeSem=S.semestres[0]?.id||null;S.activeDisc=null;}
  render();
}

async function addDisc(){
  const nome=document.getElementById('m-dname').value.trim();
  const doc=document.getElementById('m-ddoc').value.trim()||'—';
  if(!nome)return;
  const sem=getSem();if(!sem)return;
  const{data,error}=await sb.from('disciplinas').insert({semestre_id:sem.id,nome,docente:doc}).select().single();
  if(error){alert('Erro ao adicionar disciplina: '+error.message);return;}
  sem.disciplinas.push({...data,estado:'frequencia'});
  fecharModal();render();
}
async function editDisc(){
  const d=getDisc();if(!d)return;
  const nome=document.getElementById('m-dname').value.trim();
  const doc=document.getElementById('m-ddoc').value.trim();
  const patch={};if(nome)patch.nome=nome;if(doc)patch.docente=doc;
  if(!Object.keys(patch).length){fecharModal();return;}
  const{error}=await sb.from('disciplinas').update(patch).eq('id',d.id);
  if(error){alert('Erro ao guardar: '+error.message);return;}
  Object.assign(d,patch);
  fecharModal();render();
}
async function removerDisc(id){
  if(!confirm('Remover esta disciplina e todos os seus dados (notas, horários, plano)?'))return;
  const{error}=await sb.from('disciplinas').delete().eq('id',id);
  if(error){alert('Erro ao remover disciplina: '+error.message);return;}
  const sem=getSem();if(sem)sem.disciplinas=sem.disciplinas.filter(d=>d.id!==id);
  S.horarioSemana=S.horarioSemana.filter(h=>h.disciplina_id!==id);
  S.metas=S.metas.filter(m=>m.disciplina_id!==id);
  S.materiais.forEach(m=>{if(m.disciplina_id===id)m.disciplina_id=null;});
  S.lembretes.forEach(l=>{if(l.disciplina_id===id)l.disciplina_id=null;});
  S.apontamentos.forEach(a=>{if(a.disciplina_id===id)a.disciplina_id=null;});
  S.activeDisc=null;render();
}
async function lancarNota(key){
  const val=parseFloat(document.getElementById('m-nota').value);
  if(isNaN(val)||val<0||val>20){alert('Nota entre 0 e 20');return;}
  const d=getDisc();if(!d)return;
  const{error}=await sb.from('disciplinas').update({[key]:val}).eq('id',d.id);
  if(error){alert('Erro ao lançar nota: '+error.message);return;}
  d[key]=val;d.estado=calcEstado(d);
  fecharModal();render();
}
async function lancarExame(){
  const val=parseFloat(document.getElementById('m-exame').value);
  if(isNaN(val)||val<0||val>20){alert('Nota entre 0 e 20');return;}
  const d=getDisc();if(!d)return;
  const{error}=await sb.from('disciplinas').update({nota_exame:val}).eq('id',d.id);
  if(error){alert('Erro ao lançar exame: '+error.message);return;}
  d.nota_exame=val;d.estado=calcEstado(d);
  fecharModal();render();
}
async function salvarPlano(){
  const d=S.mdata.disc;if(!d)return;
  const plano={disciplina_id:d.id,objectivos:document.getElementById('p-obj').value,conteudos:document.getElementById('p-cont').value,metodologia:document.getElementById('p-met').value,bibliografia:document.getElementById('p-bib').value};
  const{error}=await sb.from('planos').upsert(plano,{onConflict:'disciplina_id'});
  if(error){alert('Erro ao guardar plano: '+error.message);return;}
  fecharModal();
}
async function addHorario(discId){
  const dia=document.getElementById('h-dia').value;
  const ini=document.getElementById('h-ini').value;
  const fim=document.getElementById('h-fim').value;
  const sala=document.getElementById('h-sala').value;
  if(!dia||!ini||!fim){alert('Preenche dia e horas');return;}
  if(ini>=fim){alert('A hora de início deve ser antes da hora de fim');return;}
  const conflito=S.horarioSemana.find(h=>h.dia_semana===dia&&ini<h.hora_fim&&h.hora_inicio<fim);
  if(conflito&&!confirm(`⚠️ Conflito com "${conflito.disc_nome}" (${conflito.hora_inicio}–${conflito.hora_fim}).\n\nAdicionar mesmo assim?`))return;
  const{data,error}=await sb.from('horarios').insert({disciplina_id:parseInt(discId),dia_semana:dia,hora_inicio:ini,hora_fim:fim,sala}).select().single();
  if(error){alert('Erro ao adicionar aula: '+error.message);return;}
  const disc=S.semestres.flatMap(s=>s.disciplinas).find(d=>d.id===data.disciplina_id);
  S.horarioSemana.push({...data,disc_nome:disc?.nome||'?',docente:disc?.docente||''});
  fecharModal();render();
}
async function removerHorario(id){
  if(!confirm('Remover esta aula?'))return;
  const{error}=await sb.from('horarios').delete().eq('id',id);
  if(error){alert('Erro ao remover: '+error.message);return;}
  S.horarioSemana=S.horarioSemana.filter(h=>h.id!==id);render();
}

/* ── LEMBRETES ── */
async function addLembrete(){
  const nome=document.getElementById('l-nome').value.trim();
  const data=document.getElementById('l-data').value;
  const tipo=document.getElementById('l-tipo').value;
  const discId=parseInt(document.getElementById('l-disc').value)||null;
  if(!nome||!data){alert('Preenche nome e data');return;}
  const{data:row,error}=await sb.from('lembretes').insert({user_id:currentUser.id,nome,data,tipo,disciplina_id:discId}).select().single();
  if(error){alert('Erro ao adicionar lembrete: '+error.message);return;}
  S.lembretes.push(row);fecharModal();render();
}
async function removerLembrete(id){
  const{error}=await sb.from('lembretes').delete().eq('id',id);
  if(error){alert('Erro: '+error.message);return;}
  S.lembretes=S.lembretes.filter(l=>l.id!==id);render();
}

/* ── METAS ── */
async function addMeta(){
  const discId=parseInt(document.getElementById('met-disc').value);
  const objetivo=parseFloat(document.getElementById('met-obj').value);
  if(!discId||isNaN(objetivo)||objetivo<0||objetivo>20){alert('Preenche correctamente');return;}
  const{data,error}=await sb.from('metas').upsert({user_id:currentUser.id,disciplina_id:discId,objetivo},{onConflict:'user_id,disciplina_id'}).select().single();
  if(error){alert('Erro ao guardar meta: '+error.message);return;}
  const idx=S.metas.findIndex(m=>m.disciplina_id===discId);
  if(idx>=0)S.metas[idx]=data;else S.metas.push(data);
  fecharModal();renderMetas();
}
async function removerMeta(id){
  const{error}=await sb.from('metas').delete().eq('id',id);
  if(error){alert('Erro: '+error.message);return;}
  S.metas=S.metas.filter(m=>m.id!==id);renderMetas();
}

/* ── APONTAMENTOS ── */
async function addApontamento(){
  const titulo=document.getElementById('ap-titulo').value.trim();
  const texto=document.getElementById('ap-texto').value.trim();
  const discId=parseInt(document.getElementById('ap-disc').value)||null;
  if(!titulo){alert('Título obrigatório');return;}
  const{data,error}=await sb.from('apontamentos').insert({user_id:currentUser.id,disciplina_id:discId,titulo,texto}).select().single();
  if(error){alert('Erro ao guardar apontamento: '+error.message);return;}
  S.apontamentos.push(data);fecharModal();
  if(S.vista==='materiais')renderMateriais();
}
async function removerApontamento(id){
  if(!confirm('Remover este apontamento?'))return;
  const{error}=await sb.from('apontamentos').delete().eq('id',id);
  if(error){alert('Erro: '+error.message);return;}
  S.apontamentos=S.apontamentos.filter(a=>a.id!==id);renderMateriais();
}

/* ── MATERIAIS (Supabase Storage) ── */
function fileIcon(ext){const m={pdf:'',docx:'',doc:'',xlsx:'',xls:'',pptx:'',ppt:'',png:'',jpg:'',jpeg:'',gif:'',mp4:'',mp3:'',zip:'',txt:''};return m[ext.toLowerCase()]||'';}
function fileTag(ext){const m={pdf:'pdf',docx:'docx',doc:'docx',xlsx:'xlsx',xls:'xlsx',pptx:'pptx',ppt:'pptx',png:'img',jpg:'img',jpeg:'img',gif:'img'};return m[ext.toLowerCase()]||'outro';}
async function uploadMaterial(){
  const fileInput=document.getElementById('m-file');
  const discId=parseInt(document.getElementById('m-matDisc').value)||null;
  const desc=document.getElementById('m-matDesc').value.trim();
  const files=Array.from(fileInput.files||[]);
  if(!files.length){alert('Selecciona um ficheiro');return;}
  const grandes=files.filter(f=>f.size>TAMANHO_MAX_FICHEIRO);
  if(grandes.length){alert(`Os seguintes ficheiros excedem o limite de 20MB e não foram enviados:\n${grandes.map(f=>f.name).join('\n')}`);return;}
  fecharModal();
  for(const file of files){
    const ext=(file.name.split('.').pop()||'').toLowerCase();
    const path=`${currentUser.id}/${Date.now()}_${Math.random().toString(36).slice(2,7)}_${file.name}`;
    const{error:upErr}=await sb.storage.from('materiais').upload(path,file);
    if(upErr){alert(`Erro ao carregar "${file.name}": `+upErr.message);continue;}
    const{data:row,error:insErr}=await sb.from('materiais').insert({
      user_id:currentUser.id,disciplina_id:discId,nome:file.name,descricao:desc,ext,tamanho:file.size,storage_path:path
    }).select().single();
    if(insErr){alert('Erro ao guardar metadados: '+insErr.message);continue;}
    S.materiais.push(row);
  }
  renderMateriais();
}
async function downloadMaterial(id){
  const mat=S.materiais.find(m=>m.id===id);if(!mat)return;
  const{data,error}=await sb.storage.from('materiais').createSignedUrl(mat.storage_path,60);
  if(error){alert('Erro ao gerar link de download: '+error.message);return;}
  window.open(data.signedUrl,'_blank');
}
async function removerMaterial(id){
  if(!confirm('Remover este material?'))return;
  const mat=S.materiais.find(m=>m.id===id);if(!mat)return;
  await sb.storage.from('materiais').remove([mat.storage_path]);
  const{error}=await sb.from('materiais').delete().eq('id',id);
  if(error){alert('Erro ao remover: '+error.message);return;}
  S.materiais=S.materiais.filter(m=>m.id!==id);renderMateriais();
}
function formatSize(b){if(b<1024)return b+'B';if(b<1048576)return(b/1024).toFixed(1)+'KB';return(b/1048576).toFixed(1)+'MB';}
function formatDate(iso){return new Date(iso).toLocaleDateString('pt-PT',{day:'2-digit',month:'short',year:'numeric'});}
function setMatDisc(id){S.matDisc=id;renderMateriais();}
function setMatTab(t){S.matTab=t;renderMateriais();}

/* ════════════════════════════════════
   COMUNIDADE (pesquisa de estudantes + mensagens)
════════════════════════════════════ */
let _msgChannel=null;
let _geralChannel=null;
let _searchTimer=null;

function setComuTab(t){S.comuTab=t;renderComunidade();}

function onComuSearchInput(){
  const q=document.getElementById('comu-search').value;
  S.comuQuery=q;
  clearTimeout(_searchTimer);
  _searchTimer=setTimeout(pesquisarEstudantes,300);
}

async function pesquisarEstudantes(){
  const q=S.comuQuery.trim();
  if(!q){S.comuResultados=[];renderComunidade();return;}
  const{data,error}=await sb.from('profiles').select('id,nome,numero,curso,ano')
    .neq('id',currentUser.id)
    .or(`nome.ilike.%${q}%,numero.ilike.%${q}%,curso.ilike.%${q}%`)
    .limit(20);
  S.comuResultados=error?[]:(data||[]);
  renderComunidade();
}

async function carregarConversas(){
  const{data}=await sb.from('conversas').select('*')
    .or(`user_a.eq.${currentUser.id},user_b.eq.${currentUser.id}`)
    .order('created_at',{ascending:false});
  const conversas=data||[];
  const outrosIds=conversas.map(c=>c.user_a===currentUser.id?c.user_b:c.user_a);
  let perfis=[];
  if(outrosIds.length){const r=await sb.from('profiles').select('id,nome,numero,curso').in('id',outrosIds);perfis=r.data||[];}
  const convIds=conversas.map(c=>c.id);
  let allMsgs=[];
  if(convIds.length){const r=await sb.from('mensagens').select('*').in('conversa_id',convIds).order('created_at',{ascending:true});allMsgs=r.data||[];}
  for(const c of conversas){
    c.outroId=c.user_a===currentUser.id?c.user_b:c.user_a;
    c.outroNome=perfis.find(p=>p.id===c.outroId)?.nome||'Estudante';
    const msgs=allMsgs.filter(m=>m.conversa_id===c.id);
    c.ultima=msgs[msgs.length-1]||null;
    c.naoLidas=msgs.filter(m=>!m.lida&&m.sender_id!==currentUser.id).length;
  }
  conversas.sort((a,b)=>new Date(b.ultima?.created_at||b.created_at)-new Date(a.ultima?.created_at||a.created_at));
  S.conversas=conversas;
}

async function abrirConversaCom(outroId,outroNome){
  const[a,b]=currentUser.id<outroId?[currentUser.id,outroId]:[outroId,currentUser.id];
  let{data:existente}=await sb.from('conversas').select('*').eq('user_a',a).eq('user_b',b).maybeSingle();
  let conv=existente;
  if(!conv){
    const{data:novo,error}=await sb.from('conversas').insert({user_a:a,user_b:b}).select().single();
    if(error){alert('Erro ao iniciar conversa: '+error.message);return;}
    conv=novo;
  }
  conv.outroId=outroId;conv.outroNome=outroNome;
  if(!S.conversas.find(c=>c.id===conv.id))S.conversas.unshift(conv);
  S.activeConversa=conv;
  S.comuTab='mensagens';
  fecharModal();
  await carregarMensagens(conv.id);
  subscribeMensagens(conv.id);
  irPara('comunidade');
}

async function abrirConversa(convId){
  const conv=S.conversas.find(c=>c.id===convId);if(!conv)return;
  S.activeConversa=conv;
  await carregarMensagens(convId);
  subscribeMensagens(convId);
  conv.naoLidas=0;
  atualizarBadgeComunidade();
  renderComunidade();
}

async function carregarMensagens(convId){
  const{data}=await sb.from('mensagens').select('*').eq('conversa_id',convId).order('created_at',{ascending:true});
  S.mensagens=data||[];
  const idsNaoLidas=S.mensagens.filter(m=>!m.lida&&m.sender_id!==currentUser.id).map(m=>m.id);
  if(idsNaoLidas.length)await sb.from('mensagens').update({lida:true}).in('id',idsNaoLidas);
  renderComunidade();
}

async function enviarMensagem(){
  const input=document.getElementById('msg-texto');
  const texto=input.value.trim();
  if(!texto||!S.activeConversa)return;
  input.value='';
  const{data,error}=await sb.from('mensagens').insert({conversa_id:S.activeConversa.id,sender_id:currentUser.id,texto}).select().single();
  if(error){alert('Erro ao enviar mensagem: '+error.message);return;}
  if(!S.mensagens.find(m=>m.id===data.id))S.mensagens.push(data);
  const conv=S.conversas.find(c=>c.id===S.activeConversa.id);
  if(conv)conv.ultima=data;
  renderComunidade();
}

function subscribeMensagens(convId){
  if(_msgChannel){sb.removeChannel(_msgChannel);_msgChannel=null;}
  _msgChannel=sb.channel('mensagens-'+convId)
    .on('postgres_changes',{event:'INSERT',schema:'public',table:'mensagens',filter:`conversa_id=eq.${convId}`},payload=>{
      if(!S.activeConversa||S.activeConversa.id!==convId)return;
      if(!S.mensagens.find(m=>m.id===payload.new.id)){
        S.mensagens.push(payload.new);
        if(payload.new.sender_id!==currentUser.id)sb.from('mensagens').update({lida:true}).eq('id',payload.new.id);
        renderComunidade();
      }
    }).subscribe();
}

function subscribeGeral(){
  if(_geralChannel)sb.removeChannel(_geralChannel);
  _geralChannel=sb.channel('mensagens-geral-'+currentUser.id)
    .on('postgres_changes',{event:'INSERT',schema:'public',table:'mensagens'},payload=>{
      if(payload.new.sender_id===currentUser.id)return;
      const conv=S.conversas.find(c=>c.id===payload.new.conversa_id);
      if(conv){
        if(!S.activeConversa||S.activeConversa.id!==conv.id){
          conv.naoLidas=(conv.naoLidas||0)+1;
          conv.ultima=payload.new;
          atualizarBadgeComunidade();
        }
      }else{
        carregarConversas().then(atualizarBadgeComunidade);
      }
    }).subscribe();
}

function atualizarBadgeComunidade(){
  const total=S.conversas.reduce((a,c)=>a+(c.naoLidas||0),0);
  const html=total>0?`<span class="comu-badge">${total}</span>`:'';
  const d=document.getElementById('comu-badge-d');if(d)d.innerHTML=html;
  const m=document.getElementById('comu-badge-m');if(m)m.innerHTML=html;
}

async function renderComunidade(){
  if(!S._comuInit){S._comuInit=true;await carregarConversas();atualizarBadgeComunidade();}
  const app=document.getElementById('app');
  const totalNaoLidas=S.conversas.reduce((a,c)=>a+(c.naoLidas||0),0);
  app.innerHTML=`
    <div class="card">
      <div class="section-head"><div class="card-h" style="margin-bottom:0">👥 Comunidade</div></div>
      <div class="tabs-2">
        <button class="tab-2 ${S.comuTab==='pesquisar'?'active':''}" onclick="setComuTab('pesquisar')">Pesquisar</button>
        <button class="tab-2 ${S.comuTab==='mensagens'?'active':''}" onclick="setComuTab('mensagens')">Mensagens${totalNaoLidas>0?` <span class="comu-badge">${totalNaoLidas}</span>`:''}</button>
      </div>
      ${S.comuTab==='pesquisar'?renderComuPesquisa():renderComuMensagens()}
    </div>`;
}

function renderComuPesquisa(){
  return`
    <input class="search-bar" type="search" id="comu-search" placeholder="🔍 Pesquisar por nome, número ou curso…" value="${esc(S.comuQuery)}" oninput="onComuSearchInput()">
    ${S.comuResultados.length===0?`<div class="empty"><div class="empty-icon">🔍</div>${S.comuQuery?'Nenhum estudante encontrado.':'Pesquisa por nome, número de estudante ou curso.'}</div>`:
      `<div class="materiais-list">${S.comuResultados.map((e,i)=>`
        <div class="material-item" style="cursor:pointer" onclick="abrirModal('perfilEstudante',{estudante:S.comuResultados[${i}]})">
          <div class="material-icon">${esc(initials(e.nome))}</div>
          <div class="material-info">
            <div class="material-name">${esc(e.nome)}</div>
            <div class="material-meta"><span>🎓 Nº ${esc(e.numero)}</span><span>📚 ${esc(e.curso||'—')}</span>${e.ano?`<span>📅 ${esc(e.ano)}º ano</span>`:''}</div>
          </div>
        </div>`).join('')}</div>`}`;
}

function renderComuMensagens(){
  const conv=S.activeConversa;
  return`
    <div class="disc-detail-grid">
      <div>
        <div class="notas-title">Conversas</div>
        ${S.conversas.length===0?'<div style="font-size:12px;color:var(--text3);padding:8px 0">Nenhuma conversa ainda. Pesquisa um estudante para começar.</div>':
          S.conversas.map(c=>`
            <div class="disc-card ${conv&&conv.id===c.id?'selected':''}" style="margin-bottom:8px" onclick="abrirConversa(${c.id})">
              <div class="disc-name">${esc(c.outroNome)}${c.naoLidas?` <span class="comu-badge">${c.naoLidas}</span>`:''}</div>
              <div class="disc-docente">${c.ultima?esc((c.ultima.sender_id===currentUser.id?'Tu: ':'')+c.ultima.texto).slice(0,60):'—'}</div>
            </div>`).join('')}
      </div>
      <div>
        ${conv?`
          <div class="notas-title">${esc(conv.outroNome)}</div>
          <div id="msg-list" style="max-height:320px;overflow-y:auto;display:flex;flex-direction:column;gap:6px;margin-bottom:10px;padding:4px 0">
            ${S.mensagens.length===0?'<div style="font-size:12px;color:var(--text3)">Ainda não há mensagens. Diz olá!</div>':S.mensagens.map(m=>`
              <div style="align-self:${m.sender_id===currentUser.id?'flex-end':'flex-start'};background:${m.sender_id===currentUser.id?'var(--accentdim)':'var(--bg3)'};border-radius:10px;padding:8px 12px;max-width:80%;font-size:13px;word-break:break-word">${esc(m.texto)}</div>`).join('')}
          </div>
          <div style="display:flex;gap:8px">
            <input id="msg-texto" placeholder="Escreve uma mensagem…" onkeydown="if(event.key==='Enter')enviarMensagem()" style="flex:1">
            <button class="btn primary" onclick="enviarMensagem()">Enviar</button>
          </div>
        `:'<div class="empty"><div class="empty-icon">💬</div>Selecciona uma conversa.</div>'}
      </div>
    </div>`;
}

/* ════════════════════════════════════
   NAVEGAÇÃO
════════════════════════════════════ */
function irPara(v){
  S.vista=v;
  document.querySelectorAll('.nav-tab').forEach(b=>{
    const bv=b.getAttribute('onclick')?.match(/'(\w+)'/)?.[1];
    b.classList.toggle('active',bv===v);
  });
  render();
}
function selectSem(id){S.activeSem=id;S.activeDisc=null;render();}
function selectDisc(id){S.activeDisc=S.activeDisc===id?null:id;render();}
function getSem(){return S.semestres.find(s=>s.id===S.activeSem);}
function getDisc(){const s=getSem();return s&&s.disciplinas.find(d=>d.id===S.activeDisc);}

/* ════════════════════════════════════
   RENDER
════════════════════════════════════ */
const DIAS=['Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];
const CORES=['#5b52e8','#0891b2','#16a34a','#b45309','#dc2626','#7c3aed','#db2777','#0f766e'];

function render(){
  if(S.vista==='horario'){renderHorario();return;}
  if(S.vista==='dashboard'){renderDashboard();return;}
  if(S.vista==='materiais'){renderMateriais();return;}
  if(S.vista==='metas'){renderMetas();return;}
  if(S.vista==='comunidade'){renderComunidade();return;}
  renderNotas();
}

/* ── NOTAS ── */
function renderNotas(){
  const sem=getSem();const disc=getDisc();
  const allD=S.semestres.flatMap(s=>s.disciplinas);
  const totAprov=allD.filter(d=>d.estado==='aprovado'||d.estado==='aprovado_freq').length;
  const totExame=allD.filter(d=>d.estado==='exame_pendente').length;
  const totRisco=allD.filter(d=>calcRisco(d)>=65).length;
  const pass=calcPassagem(sem);
  const lembretes=getLembretesProximos();

  document.getElementById('app').innerHTML=`
    ${lembretes.length>0?`<div class="lembrete-banner">
      <div class="lembrete-header"> Avaliações Próximas (próximos 14 dias)</div>
      <div class="lembrete-list">
        ${lembretes.slice(0,5).map(l=>{
          const d=diasAte(l.data);
          const cls=d<=2?'urgente':d<=5?'proximo':'ok';
          const discNome=allD.find(x=>x.id===l.disciplina_id)?.nome||'';
          return`<div class="lembrete-item">
            <span class="lembrete-dias ${cls}">${d===0?'HOJE':d===1?'AMANHÃ':'em '+d+' dias'}</span>
            <span class="lembrete-info"><strong>${esc(l.nome)}</strong>${discNome?' — '+esc(discNome):''} <span style="color:var(--text3);font-size:11px">(${esc(l.tipo)})</span></span>
            <button class="btn sm danger" onclick="removerLembrete(${l.id})" style="font-size:11px;padding:2px 7px">✕</button>
          </div>`;}).join('')}
      </div>
    </div>`:''}

    <div class="card">
      <div class="student-info">
        <div class="avatar">${esc(initials(currentUser.nome))}</div>
        <div><div class="student-name">${esc(currentUser.nome)}</div><div class="student-curso">${esc(currentUser.curso)}${currentUser.ano?' · '+esc(currentUser.ano)+'º ano':''}</div></div>
      </div>
      <div class="stats-row">
        <div class="stat"><div class="stat-label">Total Disciplinas</div><div class="stat-val">${allD.length}</div></div>
        <div class="stat"><div class="stat-label">Aprovadas</div><div class="stat-val c-green">${totAprov}</div></div>
        <div class="stat"><div class="stat-label">Ag. Exame</div><div class="stat-val c-yellow">${totExame}</div></div>
        <div class="stat"><div class="stat-label">Em Risco</div><div class="stat-val c-red">${totRisco}</div></div>
      </div>
    </div>

    <div class="card">
      <div class="section-head">
        <span class="section-title">Semestres</span>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button class="btn sm" onclick="abrirModal('lembrete')">Lembrete</button>
          <button class="btn sm" onclick="abrirModal('sem')">+ Semestre</button>
          ${S.activeSem?`<button class="btn sm danger" onclick="removerSemestre(${S.activeSem})">🗑 Apagar Semestre</button>`:''}
        </div>
      </div>
      <div class="semestre-tabs">
        ${S.semestres.length===0?'<div style="color:var(--text3);font-size:13px">Nenhum semestre. Adicione um.</div>':
          S.semestres.map(s=>`<button class="sem-tab ${s.id===S.activeSem?'active':''}" onclick="selectSem(${s.id})">${s.ano} — ${s.numero}º Sem.</button>`).join('')}
      </div>

      ${sem?`
        ${pass&&pass.total>0&&(pass.aprovadas>0||pass.naoAprov>0)?`<div class="passagem-banner ${pass.passa?'passa':'repete'}">
          <span style="font-size:18px">${pass.passa?'✅':'⚠️'}</span>
          <div>${pass.passa
            ?`<strong>Pode transitar de ano</strong> — ${pass.aprovadas} de ${pass.total} aprovadas${pass.pendentes>0?` (${pass.pendentes} pendentes)`:''}`
            :`<strong>Não transita de ano</strong> — ${pass.naoAprov} disciplina(s) reprovada(s) definitivamente (máx. 3)`}
          </div>
        </div>`:''}
        <div class="section-head" style="margin-top:.75rem">
          <span style="font-size:13px;color:var(--text2);font-weight:500">${sem.disciplinas.length} disciplina(s)</span>
          <button class="btn sm primary" onclick="abrirModal('disc')">+ Disciplina</button>
        </div>
        <div class="disciplinas-grid">
          ${sem.disciplinas.length===0?`<div class="empty" style="padding:2rem"><div class="empty-icon">📚</div>Nenhuma disciplina</div>`:
            sem.disciplinas.map(d=>{
              const{txt,cls}=estadoBadge(d.estado);
              const risco=calcRisco(d);const nr=nivelRisco(risco);
              return`<div class="disc-card ${d.id===S.activeDisc?'selected':''}" onclick="selectDisc(${d.id})">
                <div class="disc-name">${esc(d.nome)}</div>
                <div class="disc-docente">${esc(d.docente||'—')}</div>
                <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px;margin-top:6px">
                  <span class="badge ${cls}">${txt}</span>
                  ${d.estado!=='aprovado'&&d.estado!=='aprovado_freq'&&d.estado!=='reprovado'&&d.estado!=='reprovado_exame'?
                    `<span class="badge ${nr.cls}" style="font-size:10px">${nr.icon} ${nr.txt}</span>`:''}
                </div>
                ${risco>0&&d.estado!=='aprovado'&&d.estado!=='aprovado_freq'?`<div class="risk-bar-bg" style="margin-top:8px"><div class="risk-bar-fill" style="width:${risco}%;background:${risco>=65?'var(--red)':risco>=35?'var(--yellow)':'var(--green)'}"></div></div>`:''}
              </div>`;}).join('')}
        </div>
      `:'<div class="empty"><div class="empty-icon">📅</div>Seleccione ou crie um semestre</div>'}
    </div>
    ${disc?renderDetalhe(disc):''}
  `;
}

function renderDetalhe(d){
  const freq=calcFreq(d);
  const{txt:eTxt,cls:eCls}=estadoBadge(d.estado);
  const podeExame=d.estado==='exame_pendente'||d.estado==='aprovado_freq';
  const pctE=d.nota_exame!=null?Math.min(100,(d.nota_exame/20)*100):0;
  const risco=calcRisco(d);const nr=nivelRisco(risco);
  const sugestoes=sugestaoRecuperacao(d);
  const meta=S.metas.find(m=>m.disciplina_id===d.id);

  return`<div class="card">
    <div class="section-head">
      <div>
        <div style="font-size:16px;font-weight:700">${esc(d.nome)}</div>
        <div style="font-size:12px;color:var(--text2);margin-top:3px">Docente: ${esc(d.docente||'—')}</div>
        ${meta?`<div style="font-size:12px;color:var(--accent);margin-top:2px">Meta: ${meta.objetivo} val.</div>`:''}
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button class="btn sm" onclick="abrirModal('calculadora',{disc:getDisc()})">Calcular</button>
        <button class="btn sm" onclick="abrirModal('plano',{disc:getDisc()})">Plano</button>
        <button class="btn sm" onclick="abrirModal('horarioDisc',{disc:getDisc()})">Aula</button>
        <button class="btn sm" onclick="abrirModal('editDisc')">✏️</button>
        <button class="btn sm danger" onclick="removerDisc(${d.id})">🗑</button>
      </div>
    </div>

    ${d.estado!=='aprovado'&&d.estado!=='aprovado_freq'&&d.estado!=='reprovado'&&d.estado!=='reprovado_exame'?`
    <div class="risk-alert" style="${risco<65?'background:var(--yellowdim);color:var(--yellow);border-color:var(--yellowborder)':''}">
      <strong>${nr.icon} Probabilidade de reprovação: ${nr.txt} (${risco}%)</strong>
    </div>`:''}
    ${sugestoes?.length?`<div class="suggestion-box">💡 <strong>Recuperação:</strong> ${sugestoes.join('; ')}</div>`:''}
    ${meta&&freq!=null?`<div class="calc-box">Meta de ${meta.objetivo} val. — ${freq>=meta.objetivo?`Atingida! (${freq} val.) ✅`:`Faltam ${(meta.objetivo-freq).toFixed(1)} val.`}</div>`:''}

    <div class="disc-detail-grid" style="margin-top:1rem">
      <div class="notas-section">
        <div class="notas-title">Avaliação Contínua</div>
        ${[['Teste 1','teste1'],['Teste 2','teste2'],['Trabalho','trabalho']].map(([l,k])=>`
          <div class="nota-row">
            <span class="nota-label">${l}</span>
            <div style="display:flex;align-items:center;gap:8px">
              <span class="nota-val">${d[k]!=null?d[k]+' val.':'—'}</span>
              <button class="btn sm" onclick="abrirModal('nota',{key:'${k}'})">${d[k]!=null?'Corrigir':'Lançar'}</button>
            </div>
          </div>`).join('')}
        ${freq!=null?`
          <div class="freq-resultado">
            <div class="formula-hint">Frequência = (Média Testes × 60%) + (Trabalho × 40%)</div>
            <div class="freq-bar-bg"><div class="freq-bar" style="width:${Math.min(100,(freq/20)*100)}%;background:${freq>=9.5?'var(--green)':'var(--red)'}"></div></div>
            <div style="font-size:13px;font-weight:700;margin-top:6px;color:${freq>=9.5?'var(--green)':'var(--red)'}">Frequência: ${freq} val. ${freq>=9.5?'✅':'❌ (mín. 9.5)'}</div>
          </div>`:'<div style="font-size:12px;color:var(--text3);padding:8px 0">Lance todas as notas para calcular.</div>'}
      </div>
      <div class="notas-section" style="border-left:1px solid var(--border);padding-left:1rem">
        <div class="notas-title">Exame Final <span style="font-size:10px;color:var(--text3)">(mín. 9 val.)</span></div>
        ${d.estado==='frequencia'?'<div style="font-size:12px;color:var(--text3)">Conclua a frequência primeiro.</div>':`
          <div class="nota-row">
            <span class="nota-label">Nota de Exame</span>
            <div style="display:flex;align-items:center;gap:8px">
              <span class="nota-val" style="color:${d.nota_exame!=null?(d.nota_exame>=9?'var(--green)':'var(--red)'):'var(--text3)'}">${d.nota_exame!=null?d.nota_exame+' val.':'—'}</span>
              ${podeExame||d.nota_exame!=null?`<button class="btn sm ${d.nota_exame!=null?'':'primary'}" onclick="abrirModal('exame')">${d.nota_exame!=null?'Corrigir':'Lançar'}</button>`:''}
            </div>
          </div>
          ${d.nota_exame!=null?`<div class="freq-bar-bg" style="margin-top:8px"><div class="freq-bar" style="width:${pctE}%;background:${d.nota_exame>=9?'var(--green)':'var(--red)'}"></div></div>
          <div style="font-size:12px;margin-top:6px;color:${d.nota_exame>=9?'var(--green)':'var(--red)'}">${d.nota_exame>=9?'✅ Aprovado no exame':'❌ Reprovado — necessário repetir'}</div>`:''}`}
      </div>
    </div>
  </div>`;
}

/* ── HORÁRIO ── */
function renderHorario(){
  const porDia={};DIAS.forEach(d=>{porDia[d]=[];});
  S.horarioSemana.forEach(h=>{if(porDia[h.dia_semana])porDia[h.dia_semana].push(h);});
  const discIds=[...new Set(S.horarioSemana.map(h=>h.disciplina_id))];
  const corMap={};discIds.forEach((id,i)=>corMap[id]=CORES[i%CORES.length]);
  const conflitos=detectarConflitos(S.horarioSemana);
  document.getElementById('app').innerHTML=`
    <div class="card">
      <div class="section-head">
        <div>
          <div class="card-h" style="margin-bottom:0">Horário Semanal</div>
          ${conflitos.size>0?`<div style="font-size:12px;color:var(--red);margin-top:4px">⚠️ Conflito(s) detectado(s)</div>`:'<div style="font-size:12px;color:var(--green);margin-top:4px">✓ Sem conflitos</div>'}
        </div>
        <button class="btn sm primary" onclick="abrirModal('horarioPick')">+ Aula</button>
      </div>
      ${S.horarioSemana.length===0?`<div class="empty"><div class="empty-icon">🕐</div>Sem aulas definidas.</div>`:`
        <div class="horario-wrap"><div class="horario-grid">
          ${DIAS.map(dia=>`<div class="horario-col">
            <div class="horario-dia">${dia}</div>
            ${porDia[dia].length===0?'<div class="horario-vazio">—</div>':
              [...porDia[dia]].sort((a,b)=>a.hora_inicio.localeCompare(b.hora_inicio)).map(h=>`
                <div class="horario-aula" style="border-left-color:${corMap[h.disciplina_id]||'#888'};${conflitos.has(h.id)?'border-color:var(--redborder);background:var(--reddim)':''}">
                  <div class="horario-hora">${h.hora_inicio} – ${h.hora_fim}</div>
                  <div class="horario-disc">${esc(h.disc_nome)}</div>
                  ${h.sala?`<div class="horario-sala">🏫 ${esc(h.sala)}</div>`:''}
                  ${conflitos.has(h.id)?'<div class="conflict-badge">⚠️ Conflito</div>':''}
                  <button class="btn sm danger" style="margin-top:6px;font-size:10px;padding:2px 8px" onclick="removerHorario(${h.id})">✕</button>
                </div>`).join('')}
          </div>`).join('')}
        </div></div>`}
    </div>`;
}

/* ── DASHBOARD ── */
function renderDashboard(){
  const allD=S.semestres.flatMap(s=>s.disciplinas);
  const semAtual=getSem();
  const discAtual=semAtual?semAtual.disciplinas:[];
  const isDark=_tema==='dark';
  const tickColor=isDark?'#9999b3':'#5c5a7a';
  const gridColor=isDark?'rgba(255,255,255,0.04)':'rgba(0,0,0,0.06)';

  document.getElementById('app').innerHTML=`
    <div class="card">
      <div class="section-title" style="margin-bottom:1rem">Dashboard de Desempenho</div>
      ${allD.length===0?`<div class="empty"><div class="empty-icon">📈</div>Sem dados ainda.</div>`:`
      <div class="charts-grid">
        <div class="chart-card"><div class="chart-title"> Notas por Disciplina (semestre actual)</div>
          ${discAtual.length===0?'<div class="no-data"><div>📭</div>Sem disciplinas</div>':'<div class="chart-wrap"><canvas id="chart-notas"></canvas></div>'}
        </div>
        <div class="chart-card"><div class="chart-title">Estado Geral das Disciplinas</div>
          <div class="chart-wrap"><canvas id="chart-estado"></canvas></div>
        </div>
        <div class="chart-card"><div class="chart-title">Risco de Reprovação</div>
          ${discAtual.length===0?'<div class="no-data"><div>📭</div>Sem disciplinas</div>':'<div class="chart-wrap"><canvas id="chart-risco"></canvas></div>'}
        </div>
        <div class="chart-card"><div class="chart-title">Evolução por Semestre</div>
          ${S.semestres.length<1?'<div class="no-data"><div>📭</div>Sem histórico</div>':'<div class="chart-wrap"><canvas id="chart-evolucao"></canvas></div>'}
        </div>
      </div>`}
    </div>`;

  if(allD.length===0)return;
  const chartDefaults={responsive:true,maintainAspectRatio:false};

  if(discAtual.length>0){
    const ctx1=document.getElementById('chart-notas')?.getContext('2d');
    if(ctx1)new Chart(ctx1,{type:'bar',data:{
      labels:discAtual.map(d=>d.nome.length>14?d.nome.substring(0,14)+'…':d.nome),
      datasets:[
        {label:'Frequência',data:discAtual.map(d=>calcFreq(d)),backgroundColor:'rgba(91,82,232,0.7)',borderRadius:4},
        {label:'Exame',data:discAtual.map(d=>d.nota_exame),backgroundColor:'rgba(8,145,178,0.7)',borderRadius:4}
      ]
    },options:{...chartDefaults,plugins:{legend:{labels:{color:tickColor,font:{size:11}}}},scales:{y:{min:0,max:20,ticks:{color:tickColor,stepSize:5},grid:{color:gridColor}},x:{ticks:{color:tickColor,font:{size:10}},grid:{display:false}}}}});
  }

  const ctx2=document.getElementById('chart-estado')?.getContext('2d');
  if(ctx2){
    const ap=allD.filter(d=>d.estado==='aprovado'||d.estado==='aprovado_freq').length;
    const ef=allD.filter(d=>d.estado==='frequencia').length;
    const ex=allD.filter(d=>d.estado==='exame_pendente').length;
    const rp=allD.filter(d=>d.estado==='reprovado'||d.estado==='reprovado_exame').length;
    new Chart(ctx2,{type:'doughnut',data:{labels:['Aprovadas','Em Frequência','Ag. Exame','Reprovadas'],datasets:[{data:[ap,ef,ex,rp],backgroundColor:['rgba(22,163,74,0.7)','rgba(91,82,232,0.7)','rgba(180,83,9,0.7)','rgba(220,38,38,0.7)'],borderWidth:0}]},options:{...chartDefaults,plugins:{legend:{position:'bottom',labels:{color:tickColor,font:{size:11},padding:12}}},cutout:'65%'}});
  }

  if(discAtual.length>0){
    const ctx3=document.getElementById('chart-risco')?.getContext('2d');
    if(ctx3){
      const riscos=discAtual.map(d=>calcRisco(d));
      new Chart(ctx3,{type:'bar',data:{labels:discAtual.map(d=>d.nome.length>14?d.nome.substring(0,14)+'…':d.nome),datasets:[{label:'Risco (%)',data:riscos,backgroundColor:riscos.map(r=>r>=65?'rgba(220,38,38,0.7)':r>=35?'rgba(180,83,9,0.7)':'rgba(22,163,74,0.7)'),borderRadius:4}]},options:{...chartDefaults,indexAxis:'y',plugins:{legend:{display:false}},scales:{x:{min:0,max:100,ticks:{color:tickColor,callback:v=>v+'%'},grid:{color:gridColor}},y:{ticks:{color:tickColor,font:{size:10}},grid:{display:false}}}}});
    }
  }

  if(S.semestres.length>0){
    const ctx4=document.getElementById('chart-evolucao')?.getContext('2d');
    if(ctx4){
      const sems=[...S.semestres].reverse();
      const labels=sems.map(s=>`${s.ano}/${s.numero}º`);
      const medias=sems.map(s=>{const ns=s.disciplinas.map(d=>calcFreq(d)).filter(f=>f!=null);return ns.length?+(ns.reduce((a,b)=>a+b,0)/ns.length).toFixed(2):null;});
      new Chart(ctx4,{type:'line',data:{labels,datasets:[{label:'Média Frequência',data:medias,borderColor:'#5b52e8',backgroundColor:'rgba(91,82,232,0.1)',tension:.4,fill:true,pointBackgroundColor:'#5b52e8'}]},options:{...chartDefaults,plugins:{legend:{labels:{color:tickColor,font:{size:11}}}},scales:{y:{min:0,max:20,ticks:{color:tickColor},grid:{color:gridColor}},x:{ticks:{color:tickColor},grid:{display:false}}}}});
    }
  }
}

/* ── MATERIAIS ── */
function renderMateriais(){
  const allD=S.semestres.flatMap(s=>s.disciplinas);
  let mats=S.materiais;
  let apts=S.apontamentos;

  if(S.matSearch){
    const q=S.matSearch.toLowerCase();
    mats=mats.filter(m=>m.nome.toLowerCase().includes(q)||(m.descricao||'').toLowerCase().includes(q));
    apts=apts.filter(a=>a.titulo.toLowerCase().includes(q)||(a.texto||'').toLowerCase().includes(q));
  }
  if(S.matDisc){
    mats=mats.filter(m=>m.disciplina_id===S.matDisc);
    apts=apts.filter(a=>a.disciplina_id===S.matDisc);
  }

  document.getElementById('app').innerHTML=`
    <div class="card">
      <div class="section-head">
        <div>
          <div class="card-h" style="margin-bottom:0">📁 Materiais & Apontamentos</div>
          <div style="font-size:12px;color:var(--text2);margin-top:3px">${S.materiais.length} ficheiro(s) · ${S.apontamentos.length} apontamento(s)</div>
        </div>
        <div style="display:flex;gap:6px">
          <button class="btn sm primary" onclick="abrirModal('uploadMat')">📎 Carregar</button>
          <button class="btn sm" onclick="abrirModal('novoApontamento')">Apontamento</button>
        </div>
      </div>

      <input class="search-bar" type="search" placeholder="🔍 Pesquisar…" value="${esc(S.matSearch)}" oninput="S.matSearch=this.value;renderMateriais()">

      <div class="tabs-2">
        <button class="tab-2 ${S.matTab==='ficheiros'?'active':''}" onclick="setMatTab('ficheiros')">📎 Ficheiros (${mats.length})</button>
        <button class="tab-2 ${S.matTab==='apontamentos'?'active':''}" onclick="setMatTab('apontamentos')">Apontamentos (${apts.length})</button>
      </div>

      ${allD.length>0?`<div class="disc-filter">
        <button class="disc-filter-btn ${!S.matDisc?'active':''}" onclick="setMatDisc(null)">Todos</button>
        ${allD.map(d=>`<button class="disc-filter-btn ${S.matDisc===d.id?'active':''}" onclick="setMatDisc(${d.id})">${esc(d.nome.length>20?d.nome.substring(0,20)+'…':d.nome)}</button>`).join('')}
      </div>`:''}

      ${S.matTab==='ficheiros'?`
        ${mats.length===0?`<div class="empty"><div class="empty-icon">📂</div>${S.matSearch||S.matDisc?'Nenhum ficheiro encontrado.':'Nenhum ficheiro ainda.'}</div>`:`
          <div class="materiais-list">
            ${[...mats].sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)).map(m=>{
              const discNome=allD.find(d=>d.id===m.disciplina_id)?.nome;
              return`<div class="material-item">
                <div class="material-icon">${fileIcon(m.ext)}</div>
                <div class="material-info">
                  <div class="material-name">${esc(m.nome)}</div>
                  <div class="material-meta">
                    <span class="tag ${fileTag(m.ext)}">${m.ext.toUpperCase()}</span>
                    ${discNome?`<span>📚 ${esc(discNome)}</span>`:''}
                    <span>📅 ${formatDate(m.created_at)}</span>
                    <span>💾 ${formatSize(m.tamanho)}</span>
                    ${m.descricao?`<span>— ${esc(m.descricao)}</span>`:''}
                  </div>
                </div>
                <div class="material-actions">
                  <button class="btn sm success" onclick="downloadMaterial(${m.id})">⬇</button>
                  <button class="btn sm danger" onclick="removerMaterial(${m.id})">🗑</button>
                </div>
              </div>`;}).join('')}
          </div>`}`
      :`
        ${apts.length===0?`<div class="empty"><div class="empty-icon">📝</div>${S.matSearch||S.matDisc?'Nenhum apontamento encontrado.':'Nenhum apontamento ainda.'}</div>`:`
          <div>
            ${[...apts].sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)).map(a=>{
              const discNome=allD.find(d=>d.id===a.disciplina_id)?.nome;
              return`<div class="apontamento-card">
                <div class="apontamento-header">
                  <div class="apontamento-titulo">${esc(a.titulo)}</div>
                  <button class="btn sm danger" onclick="removerApontamento(${a.id})" style="flex-shrink:0">🗑</button>
                </div>
                ${a.texto?`<div class="apontamento-texto">${esc(a.texto)}</div>`:''}
                <div class="apontamento-meta">
                  ${discNome?`<span>📚 ${esc(discNome)}</span>`:''}
                  <span>📅 ${formatDate(a.created_at)}</span>
                </div>
              </div>`;}).join('')}
          </div>`}`}
    </div>`;
}

/* ── METAS ── */
function renderMetas(){
  const allD=S.semestres.flatMap(s=>s.disciplinas);
  document.getElementById('app').innerHTML=`
    <div class="card">
      <div class="section-head">
        <div>
          <div class="card-h" style="margin-bottom:0">🎯 Metas Pessoais</div>
          <div style="font-size:12px;color:var(--text2);margin-top:3px">Define objectivos de nota por disciplina</div>
        </div>
        <button class="btn sm primary" onclick="abrirModal('novaMeta')">+ Meta</button>
      </div>

      ${S.metas.length===0?`<div class="empty"><div class="empty-icon">🎯</div>Nenhuma meta definida ainda.</div>`:`
        <div style="display:flex;flex-direction:column;gap:10px">
          ${S.metas.map(meta=>{
            const disc=allD.find(d=>d.id===meta.disciplina_id);
            if(!disc)return'';
            const freq=calcFreq(disc);
            const atual=freq??0;
            const pct=Math.min(100,(atual/meta.objetivo)*100);
            const atingida=freq!=null&&freq>=meta.objetivo;
            const cor=atingida?'var(--green)':pct>=70?'var(--yellow)':'var(--red)';
            return`<div class="meta-card">
              <div class="meta-header">
                <div>
                  <div class="meta-disc">${esc(disc.nome)}</div>
                  <div class="meta-objetivo">Meta: ${meta.objetivo} val. · Actual: ${freq!=null?freq+' val.':'sem notas'}</div>
                </div>
                <div style="display:flex;align-items:center;gap:8px">
                  ${atingida?'<span class="badge aprovado">✅ Atingida</span>':''}
                  <button class="btn sm danger" onclick="removerMeta(${meta.id})">🗑</button>
                </div>
              </div>
              <div class="meta-bar-bg">
                <div class="meta-bar" style="width:${freq!=null?pct:0}%;background:${cor}"></div>
              </div>
              <div class="meta-labels">
                <span>0</span>
                <span>${freq!=null?atual+' val. ('+Math.round(pct)+'%)':'sem dados'}</span>
                <span>${meta.objetivo}</span>
              </div>
            </div>`;}).join('')}
        </div>`}
    </div>`;
}

/* ════════════════════════════════════
   MODAIS
════════════════════════════════════ */
async function abrirModal(tipo,data={}){
  S.modal=tipo;S.mdata=data;
  const root=document.getElementById('modal-root');
  const todasDiscs=S.semestres.flatMap(s=>s.disciplinas);
  let body='';

  if(tipo==='sem'){
    body=`<h2>Adicionar Semestre</h2>
      <div class="form-row">
        <div><label>Ano</label><input id="m-ano" type="number" value="${new Date().getFullYear()}"></div>
        <div><label>Semestre</label><select id="m-sem"><option value="1">1º</option><option value="2">2º</option></select></div>
      </div>
      <div class="modal-actions"><button class="btn" onclick="fecharModal()">Cancelar</button><button class="btn primary" onclick="addSemestre()">Adicionar</button></div>`;

  }else if(tipo==='disc'||tipo==='editDisc'){
    const d=tipo==='editDisc'?getDisc():null;
    body=`<h2>${d?'Editar':'Adicionar'} Disciplina</h2>
      <div class="form-row full"><label>Nome</label><input id="m-dname" value="${d?esc(d.nome):''}" placeholder="ex: Estrutura de Dados"></div>
      <div class="form-row full"><label>Docente</label><input id="m-ddoc" value="${d?esc(d.docente||''):''}" placeholder="ex: Prof. Silva"></div>
      <div class="modal-actions"><button class="btn" onclick="fecharModal()">Cancelar</button><button class="btn primary" onclick="${d?'editDisc()':'addDisc()'}">Guardar</button></div>`;

  }else if(tipo==='nota'){
    const lbls={teste1:'Teste 1',teste2:'Teste 2',trabalho:'Trabalho'};
    const d=getDisc();const k=data.key;
    body=`<h2>Lançar ${lbls[k]}</h2>
      <div class="form-row full"><label>Nota (0 – 20)</label><input id="m-nota" type="number" min="0" max="20" step="0.5" value="${d&&d[k]!=null?d[k]:''}"></div>
      <div class="modal-actions"><button class="btn" onclick="fecharModal()">Cancelar</button><button class="btn primary" onclick="lancarNota('${k}')">Lançar</button></div>`;

  }else if(tipo==='exame'){
    const d=getDisc();
    body=`<h2>Nota de Exame</h2>
      <p style="font-size:13px;color:var(--text2);margin-bottom:1rem">Mínimo de <strong>9 valores</strong> para aprovação.</p>
      <div class="form-row full"><label>Nota (0 – 20)</label><input id="m-exame" type="number" min="0" max="20" step="0.5" value="${d&&d.nota_exame!=null?d.nota_exame:''}"></div>
      <div class="modal-actions"><button class="btn" onclick="fecharModal()">Cancelar</button><button class="btn primary" onclick="lancarExame()">Lançar</button></div>`;

  }else if(tipo==='plano'){
    const d=data.disc;
    const{data:planoRow}=await sb.from('planos').select('*').eq('disciplina_id',d.id).maybeSingle();
    const p=planoRow||{};
    body=`<h2>📋 Plano — ${esc(d.nome)}</h2>
      <div class="form-row full"><label>Objectivos</label><textarea id="p-obj" rows="3">${esc(p.objectivos||'')}</textarea></div>
      <div class="form-row full"><label>Conteúdos</label><textarea id="p-cont" rows="4">${esc(p.conteudos||'')}</textarea></div>
      <div class="form-row full"><label>Metodologia</label><textarea id="p-met" rows="2">${esc(p.metodologia||'')}</textarea></div>
      <div class="form-row full"><label>Bibliografia</label><textarea id="p-bib" rows="2">${esc(p.bibliografia||'')}</textarea></div>
      <div class="modal-actions"><button class="btn" onclick="fecharModal()">Cancelar</button><button class="btn primary" onclick="salvarPlano()">Guardar</button></div>`;

  }else if(tipo==='horarioDisc'||tipo==='horarioPick'){
    const disc=data.disc;
    body=`<h2>Adicionar Aula</h2>
      ${todasDiscs.length>1&&!disc?`<div class="form-row full"><label>Disciplina</label><select id="h-disc">${todasDiscs.map(d=>`<option value="${d.id}">${esc(d.nome)}</option>`).join('')}</select></div>`
        :`<p style="font-size:14px;font-weight:600;margin-bottom:.75rem">${esc(disc?disc.nome:todasDiscs[0]?.nome||'')}</p><input type="hidden" id="h-disc" value="${disc?disc.id:todasDiscs[0]?.id||0}">`}
      <div class="form-row"><div><label>Dia</label><select id="h-dia">${DIAS.map(d=>`<option>${d}</option>`).join('')}</select></div><div><label>Sala</label><input id="h-sala" placeholder="ex: A-201"></div></div>
      <div class="form-row"><div><label>Início</label><input id="h-ini" type="time" value="08:00"></div><div><label>Fim</label><input id="h-fim" type="time" value="10:00"></div></div>
      <div style="font-size:12px;color:var(--text2);background:var(--bg3);padding:8px 12px;border-radius:8px;margin-bottom:.5rem">ℹ️ Conflitos detectados automaticamente antes de guardar.</div>
      <div class="modal-actions"><button class="btn" onclick="fecharModal()">Cancelar</button><button class="btn primary" onclick="addHorario(document.getElementById('h-disc').value)">Adicionar</button></div>`;

  }else if(tipo==='uploadMat'){
    body=`<h2>Carregar Ficheiro</h2>
      <div class="form-row full"><label>Disciplina (opcional)</label><select id="m-matDisc"><option value="">— Geral —</option>${todasDiscs.map(d=>`<option value="${d.id}">${esc(d.nome)}</option>`).join('')}</select></div>
      <div class="form-row full"><label>Descrição</label><input id="m-matDesc" placeholder="ex: Resumo Capítulo 3"></div>
      <div class="form-row full"><label>Ficheiro(s) — máx. 20MB cada</label>
        <div class="upload-area" onclick="document.getElementById('m-file').click()">
          <div class="upload-icon">📎</div><div class="upload-text">Clica para seleccionar</div><div class="upload-sub">PDF, Word, Excel, PowerPoint, Imagens…</div>
        </div>
        <input id="m-file" type="file" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.png,.jpg,.jpeg,.gif,.txt,.zip" style="display:none" onchange="document.querySelector('.upload-text').textContent=this.files.length>1?this.files.length+' ficheiros':this.files[0]?.name||'Seleccionar'">
      </div>
      <div class="modal-actions"><button class="btn" onclick="fecharModal()">Cancelar</button><button class="btn primary" onclick="uploadMaterial()">Carregar</button></div>`;

  }else if(tipo==='novoApontamento'){
    body=`<h2> Novo Apontamento</h2>
      <div class="form-row full"><label>Disciplina (opcional)</label><select id="ap-disc"><option value="">— Geral —</option>${todasDiscs.map(d=>`<option value="${d.id}">${esc(d.nome)}</option>`).join('')}</select></div>
      <div class="form-row full"><label>Título</label><input id="ap-titulo" placeholder="ex: Resumo da aula de hoje"></div>
      <div class="form-row full"><label>Texto</label><textarea id="ap-texto" rows="6" placeholder="Escreve aqui os teus apontamentos…"></textarea></div>
      <div class="modal-actions"><button class="btn" onclick="fecharModal()">Cancelar</button><button class="btn primary" onclick="addApontamento()">Guardar</button></div>`;

  }else if(tipo==='lembrete'){
    body=`<h2>Adicionar Lembrete</h2>
      <div class="form-row full"><label>Nome da Avaliação</label><input id="l-nome" placeholder="ex: Teste 1 de POO"></div>
      <div class="form-row"><div><label>Data</label><input id="l-data" type="date" value="${new Date().toISOString().slice(0,10)}"></div><div><label>Tipo</label><select id="l-tipo"><option>Teste</option><option>Exame</option><option>Trabalho</option><option>Entrega</option><option>Apresentação</option></select></div></div>
      <div class="form-row full"><label>Disciplina (opcional)</label><select id="l-disc"><option value="">— Geral —</option>${todasDiscs.map(d=>`<option value="${d.id}">${esc(d.nome)}</option>`).join('')}</select></div>
      <div class="modal-actions"><button class="btn" onclick="fecharModal()">Cancelar</button><button class="btn primary" onclick="addLembrete()">Adicionar</button></div>`;

  }else if(tipo==='novaMeta'){
    body=`<h2>Definir Meta</h2>
      <div class="form-row full"><label>Disciplina</label><select id="met-disc"><option value="">Selecciona…</option>${todasDiscs.map(d=>`<option value="${d.id}">${esc(d.nome)}</option>`).join('')}</select></div>
      <div class="form-row full">
        <label>Objectivo de nota na frequência: <strong id="met-obj-label">14</strong> val.</label>
        <input id="met-obj" type="range" min="9.5" max="20" step="0.5" value="14" oninput="document.getElementById('met-obj-label').textContent=this.value">
      </div>
      <div class="modal-actions"><button class="btn" onclick="fecharModal()">Cancelar</button><button class="btn primary" onclick="addMeta()">Guardar</button></div>`;

  }else if(tipo==='calculadora'){
    const d=data.disc;
    const freq=calcFreq(d);
    body=`<h2> Calculadora — ${esc(d.nome)}</h2>
      <div style="font-size:13px;color:var(--text2);margin-bottom:1rem">
        Notas actuais: T1=${d.teste1??'—'} · T2=${d.teste2??'—'} · Trabalho=${d.trabalho??'—'}<br>
        ${freq!=null?`Frequência actual: <strong>${freq} val.</strong>`:'Frequência: ainda sem todas as notas'}
      </div>
      <div class="form-row full">
        <label>Quero atingir <strong id="calc-obj-label">12</strong> val. na frequência</label>
        <input id="calc-obj" type="range" min="9.5" max="20" step="0.5" value="12" oninput="actualizarCalc('${d.id}')">
      </div>
      <div id="calc-resultado" class="calc-result"></div>
      <div class="modal-actions"><button class="btn primary" onclick="fecharModal()">Fechar</button></div>`;

    setTimeout(()=>{actualizarCalc_disc=d;actualizarCalc(d.id);},50);

  }else if(tipo==='perfilEstudante'){
    const e=data.estudante;
    body=`<h2>${esc(initials(e.nome))} — ${esc(e.nome)}</h2>
      <div style="font-size:13px;color:var(--text2);margin-bottom:1rem;display:flex;flex-direction:column;gap:4px">
        <div>🎓 Nº ${esc(e.numero)}</div>
        <div>📚 ${esc(e.curso||'—')}</div>
        ${e.ano?`<div>📅 ${esc(e.ano)}º ano</div>`:''}
      </div>
      <div class="modal-actions"><button class="btn" onclick="fecharModal()">Fechar</button><button class="btn primary" onclick="abrirConversaCom(S.mdata.estudante.id,S.mdata.estudante.nome)">💬 Enviar mensagem</button></div>`;
  }

  root.innerHTML=`<div class="modal-overlay" onclick="if(event.target===this)fecharModal()"><div class="modal">${body}</div></div>`;
}

let actualizarCalc_disc=null;
function actualizarCalc(discId){
  const d=actualizarCalc_disc||S.semestres.flatMap(s=>s.disciplinas).find(x=>x.id==discId);
  if(!d)return;
  const obj=document.getElementById('calc-obj')?.value;
  const lbl=document.getElementById('calc-obj-label');
  const res=document.getElementById('calc-resultado');
  if(lbl)lbl.textContent=obj;
  if(!res)return;
  const r=calcNotaNecessaria(d,obj);
  if(!r){res.innerHTML='<div class="calc-result-label">—</div>';return;}
  if(r.tipo==='completo'){
    const freq=r.freq;
    res.innerHTML=`<div class="calc-result-label">Frequência calculada</div><div class="calc-result-val ${freq>=parseFloat(obj)?'facil':'impossivel'}">${freq} val. ${freq>=parseFloat(obj)?'✅ Já atingiste o objectivo!':'❌ Abaixo do objectivo'}</div>`;
  }else if(r.tipo==='trabalho'||r.tipo==='teste'){
    const val=r.val;
    const impossivel=val<0||val>20;
    res.innerHTML=`<div class="calc-result-label">Para atingir ${obj} val., precisas de:</div>
      <div class="calc-result-val ${impossivel?'impossivel':val>=14?'facil':'dificil'}">${impossivel?'Impossível ('+val+' val.)':val+' val. no '+r.label}</div>
      ${impossivel?'<div style="font-size:12px;color:var(--red);margin-top:6px">Com as notas actuais, este objectivo não é atingível.</div>':
        val<9.5?'<div style="font-size:12px;color:var(--green);margin-top:6px">Relativamente acessível — menos de 9.5 val. necessários.</div>':
        val>16?'<div style="font-size:12px;color:var(--yellow);margin-top:6px">Exigente — requer grande esforço.</div>':''}`;
  }else{
    res.innerHTML=`<div class="calc-result-label">Lança mais notas para obter o cálculo preciso.</div>`;
  }
}

function fecharModal(){
  S.modal=null;S.mdata={};actualizarCalc_disc=null;
  document.getElementById('modal-root').innerHTML='';
}

/* ════════════════════════════════════
   ARRANQUE
════════════════════════════════════ */
function continuarDeBoasVindas(){
  localStorage.setItem('ga_visitou','1');
  document.getElementById('welcome-screen').style.display='none';
  document.getElementById('auth-screen').style.display='';
  showTab('reg');
}

(async function init(){
  aplicarTema(_tema);
  const{data:{session}}=await sb.auth.getSession();
  if(session){
    await carregarPerfilEEntrar(session.user);
    return;
  }
  if(!localStorage.getItem('ga_visitou')){
    document.getElementById('welcome-screen').style.display='';
  }else{
    document.getElementById('auth-screen').style.display='';
  }
})();
