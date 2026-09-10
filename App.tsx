import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { CaptureFlow, type ReviewedCandidate } from './src/components/CaptureFlow';
import { findDuplicates } from './src/services/duplicates';
import type { PaymentCandidate } from './src/services/payments';
import { defaultSettings, deleteExpense, insertExpense, loadExpenses, loadSettings, saveSettings, updateExpense } from './src/services/storage';
import type { AppSettings, Expense, ExpenseDraft } from './src/types/expense';

type Tab = 'home' | 'add' | 'history' | 'stats' | 'settings';
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
const blank = (): ExpenseDraft => ({ storeName: '', date: today(), amount: '', category: 'その他', paymentMethod: '未設定', note: '', sourceType: 'receipt', confidence: 1, rawText: '' });
const yen = (n: number) => `¥${Math.round(n).toLocaleString('ja-JP')}`;
const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
const monthLabel = (key: string) => { const [y, m] = key.split('-'); return `${y}年${Number(m)}月`; };
const shiftMonth = (key: string, step: number) => { const [y, m] = key.split('-').map(Number); return monthKey(new Date(y!, m! - 1 + step, 1)); };

export default function App() {
  const [tab, setTab] = useState<Tab>('home');
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [month, setMonth] = useState(monthKey(new Date()));
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('すべて');
  const [historyAll, setHistoryAll] = useState(true);
  const [draft, setDraft] = useState(blank());
  const [imageUri, setImageUri] = useState<string>();
  const [editingId, setEditingId] = useState<string>();
  const [processing, setProcessing] = useState(false);
  const [newCategory, setNewCategory] = useState('');

  const [ready, setReady] = useState(false);
  const busy = useRef(false);
  const ocrRequest = useRef(0);
  const [saving, setSaving] = useState(false);
  const [pending, setPending] = useState<ReviewedCandidate[]>([]);
  const [captureVisible,setCaptureVisible]=useState(false);
  const [captureDirty,setCaptureDirty]=useState(false);
  const [captureSession,setCaptureSession]=useState(0);
  const batchSignature=useRef('');
  const batchCounts=useRef({saved:0,skipped:0});
  const [candidateKind, setCandidateKind] = useState<PaymentCandidate['kind']>('expense');
  const initialize = () => Promise.all([loadExpenses(), loadSettings()]).then(([e, s]) => { setExpenses(e); setSettings(s); setReady(true); }).catch(() => Alert.alert('データを読み込めません', '保存済みデータを保護するため、再読み込みしてください。', [{text:'再試行', onPress:initialize}]));
  useEffect(() => { void initialize(); }, []);
  const monthly = useMemo(() => expenses.filter((e) => e.date.startsWith(month)), [expenses, month]);
  const filtered = useMemo(() => (historyAll ? expenses : monthly).filter((e) => (categoryFilter === 'すべて' || e.category === categoryFilter) && `${e.storeName} ${e.note} ${e.paymentMethod}`.toLowerCase().includes(query.toLowerCase())), [expenses, monthly, historyAll, query, categoryFilter]);
  const total = monthly.reduce((sum, e) => sum + Number(e.amount), 0);
  const categories = settings.categories.map((name) => ({ name, value: monthly.filter((e) => e.category === name).reduce((sum, e) => sum + Number(e.amount), 0) })).filter((x) => x.value > 0).sort((a, b) => b.value - a.value);

  const refreshExpenses = async () => setExpenses(await loadExpenses());
  const resetForm = () => { setDraft(blank()); setImageUri(undefined); setEditingId(undefined); setPending([]); setCandidateKind('expense');setCaptureVisible(false);setCaptureSession(n=>n+1);batchSignature.current='';batchCounts.current={saved:0,skipped:0}; };
  const advance = (saved=false) => {
    if(batchSignature.current) batchCounts.current[saved?'saved':'skipped']++;
    const next=pending[0];
    if(next) { setDraft(next.draft);setImageUri(next.imageUri);setCandidateKind(next.kind);setPending(pending.slice(1)); }
    else {
      if(batchSignature.current) Alert.alert('確認が完了しました',`${batchCounts.current.saved}件保存・${batchCounts.current.skipped}件スキップ`,[{text:'閉じる'},{text:'履歴を開く',onPress:()=>setTab('history')}]);
      resetForm();
    }
  };
  const cancelCapture = () => { if(saving)return;Alert.alert('未保存の内容を破棄しますか？','画像と入力内容が消えます。保存済みの支出は残ります。',[{text:'戻る',style:'cancel'},{text:'破棄する',style:'destructive',onPress:()=>{ocrRequest.current++;busy.current=false;setProcessing(false);resetForm();}}]); };
  const chooseImage = (_camera:boolean) => {if(!busy.current) setCaptureVisible(true);};
  const acceptImages=(rows:ReviewedCandidate[],signature:string)=>{
    if(signature===batchSignature.current) {setCaptureVisible(false);return;}
    const accept=()=>{const first=rows[0];if(!first)return;batchSignature.current=signature;batchCounts.current={saved:0,skipped:0};setDraft(first.draft);setImageUri(first.imageUri);setCandidateKind(first.kind);setPending(rows.slice(1));setEditingId(undefined);setCaptureVisible(false);setTab('add');};
    if(draft.rawText || draft.storeName || draft.amount) Alert.alert('読み取り結果を更新しますか？','現在の未保存の入力内容が新しい読み取り結果に置き換わります。',[{text:'戻る',style:'cancel'},{text:'更新する',onPress:accept}]);
    else accept();
  };
  const submit = async (confirmed = false) => {
    if (busy.current || !ready) return;
    if (!draft.storeName.trim() || !/^20\d{2}-\d{2}-\d{2}$/.test(draft.date) || !Number.isFinite(Number(draft.amount)) || Number(draft.amount) <= 0) return Alert.alert('入力確認', '店舗名、日付（例：2026-09-10）、0円より大きい金額を入力してください。');
    const parsedDate=new Date(draft.date+'T00:00:00Z');
    if (!Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0,10)!==draft.date) return Alert.alert('入力確認','実在する日付を入力してください。');
    if (!confirmed) {
      const matches=findDuplicates(draft,expenses,editingId);
      if(matches.length || candidateKind !== 'expense') {
        Alert.alert('保存前の確認', [candidateKind!=='expense' ? '購入以外の取引の可能性があります。支出として保存しますか？' : '', ...matches.slice(0,3).map(m=>`${m.reason}\n${m.item.date} ${m.item.storeName} ${yen(Number(m.item.amount))}`)].filter(Boolean).join('\n\n'), [{text:'戻る',style:'cancel'},{text:'別の支出として保存',onPress:()=>void submit(true)}]);
        return;
      }
    }
    const isBatch=Boolean(batchSignature.current);
    const item: Expense = { ...draft, id: editingId ?? Date.now().toString(), imageUri:isBatch?undefined:imageUri };
    busy.current = true; setSaving(true);
    try { editingId ? await updateExpense(item) : await insertExpense(item); await refreshExpenses(); advance(true); setQuery(''); setCategoryFilter('すべて'); setHistoryAll(true); setMonth(item.date.slice(0, 7)); if(!pending.length) setTab('home'); if(!isBatch)Alert.alert('保存しました', `${item.storeName} ${yen(Number(item.amount))}`); }
    catch { Alert.alert('保存できませんでした', '入力内容は残っています。もう一度保存してください。'); }
    finally { busy.current = false; setSaving(false); }
  };
  const edit = (item: Expense) => {
    const open=()=>{resetForm();setDraft(item);setImageUri(item.imageUri);setEditingId(item.id);setTab('add');};
    if(captureDirty || draft.storeName || draft.amount) Alert.alert('現在の未保存の作業を破棄しますか？','この支出の編集画面を開きます。',[{text:'戻る',style:'cancel'},{text:'破棄して編集',style:'destructive',onPress:open}]); else open();
  };
  const remove = (id: string) => Alert.alert('削除しますか？', 'この支出は元に戻せません。', [{ text: 'キャンセル' }, { text: '削除', style: 'destructive', onPress: async () => { if(busy.current) return; busy.current=true; try { await deleteExpense(id); await refreshExpenses(); } catch { Alert.alert('削除できませんでした'); } finally {busy.current=false;} } }]);
  const updateSettings = async (next: AppSettings) => { try { await saveSettings(next); setSettings(next); } catch { Alert.alert('設定を保存できませんでした'); } };

  if (!ready) return <SafeAreaProvider><SafeAreaView style={s.safe}><ActivityIndicator /><Text>保存済みデータを読み込み中…</Text></SafeAreaView></SafeAreaProvider>;
  return <SafeAreaProvider><SafeAreaView style={s.safe} edges={['top','left','right']}><StatusBar style="dark" />
    <View style={s.header}><Text style={s.logo}>ReceiptLog</Text><Text style={s.headerMonth}>{monthLabel(month)}</Text></View>
    <ScrollView contentContainerStyle={s.page} keyboardShouldPersistTaps="handled">
      {tab === 'home' && <Home month={month} setMonth={setMonth} total={total} budget={settings.monthlyBudget} count={monthly.length} categories={categories} recent={expenses.slice(0,3)} setTab={setTab} />}
      {tab === 'add' && <>{pending.length>0 && <Text style={s.warning}>この取引の後に {pending.length} 件あります。1件ずつ確認してください。</Text>}{!processing && !saving && draft.rawText && !editingId && <Pressable style={s.secondaryButton} onPress={()=>advance()}><Text style={s.secondaryText}>この取引をスキップ</Text></Pressable>}<Add draft={draft} setDraft={setDraft} imageUri={imageUri} processing={processing || saving} editing={Boolean(editingId)} categories={settings.categories} chooseImage={chooseImage} submit={()=>void submit()} reset={cancelCapture} cancel={cancelCapture} /></>}
      {tab === 'history' && <History month={month} setMonth={setMonth} all={historyAll} setAll={setHistoryAll} query={query} setQuery={setQuery} filter={categoryFilter} setFilter={setCategoryFilter} categories={settings.categories} items={filtered} edit={edit} remove={remove} />}
      {tab === 'stats' && <Stats month={month} setMonth={setMonth} total={total} categories={categories} />}
      {tab === 'settings' && <Settings settings={settings} update={updateSettings} newCategory={newCategory} setNewCategory={setNewCategory} />}
    </ScrollView>
    <SafeAreaView style={s.navSafe} edges={['bottom']}><View style={s.nav}>{([['home','ホーム'],['add','追加'],['history','履歴'],['stats','分析'],['settings','設定']] as [Tab,string][]).map(([key,label]) => <Pressable key={key} style={s.navItem} onPress={() => { if(busy.current) return; setTab(key); }}><Text style={[s.navText, tab === key && s.navActive]}>{label}</Text></Pressable>)}</View></SafeAreaView>
    <CaptureFlow key={captureSession} visible={captureVisible} onClose={()=>setCaptureVisible(false)} onDiscard={resetForm} onComplete={acceptImages} aiEnabled={settings.aiFallbackEnabled} onDirty={setCaptureDirty}/>
  </SafeAreaView></SafeAreaProvider>;
}

function Home({ month, setMonth, total, budget, count, categories, recent, setTab }: { month:string; setMonth:(m:string)=>void; total:number; budget:number; count:number; categories:{name:string;value:number}[]; recent:Expense[]; setTab:(t:Tab)=>void }) {
  const left = budget - total, ratio = budget ? Math.min(total / budget, 1) : 0;
  return <><MonthNav month={month} setMonth={setMonth}/><Text style={s.eyebrow}>{monthLabel(month)}の支出</Text><View style={s.hero}><Text style={s.heroAmount}>{yen(total)}</Text><Text style={s.heroMeta}>{count}件 · 予算残り {yen(left)}</Text><View style={s.progress}><View style={[s.progressFill,{width:`${ratio*100}%`}]} /></View></View>
    <View style={s.quickRow}><Quick label="OCRで追加" onPress={()=>setTab('add')} /><Quick label="月別履歴" onPress={()=>setTab('history')} /></View>
    <Title text="カテゴリ別" />{categories.length ? categories.slice(0,5).map((x)=><Bar key={x.name} {...x} max={total}/>) : <Empty text="この月の支出はまだありません。" />}
    <Title text="最近保存した支出" />{recent.length?recent.map(item=><View key={item.id} style={s.expense}><View style={{flex:1}}><Text style={s.expenseStore}>{item.storeName}</Text><Text style={s.expenseMeta}>{item.date} · {item.category}</Text></View><Text style={s.expenseAmount}>{yen(Number(item.amount))}</Text></View>):<Empty text="保存した支出はありません。"/>}</>;
}

function Add({draft,setDraft,imageUri,processing,editing,categories,chooseImage,submit,reset,cancel}:{draft:ExpenseDraft;setDraft:(d:ExpenseDraft)=>void;imageUri?:string;processing:boolean;editing:boolean;categories:string[];chooseImage:(c:boolean)=>void;submit:()=>void;reset:()=>void;cancel:()=>void}) {
  const set=(key:keyof ExpenseDraft,value:string)=>setDraft({...draft,[key]:value});
  return <><Title text={editing?'支出を編集':draft.rawText?'読み取り結果を確認':'支出を追加'} /><Text style={s.help}>読み取り結果も手入力も、保存前に必ず確認できます。</Text>
    {!editing && <View style={s.quickRow}><Quick label={draft.rawText?'画像確認に戻る':'撮影・画像を選択'} onPress={()=>chooseImage(true)}/></View>}
    {Platform.OS === 'web' && <Text style={s.warning}>ブラウザー版では手入力できます。画像の読み取りはスマートフォン版で利用してください。</Text>}
    {imageUri && <Image source={{uri:imageUri}} style={s.preview} resizeMode="contain"/>}{processing && <><ActivityIndicator style={s.loader} color="#0f766e" size="large"/><Pressable style={s.secondaryButton} onPress={cancel}><Text style={s.secondaryText}>OCRをキャンセル</Text></Pressable></>}
    {!processing && <View style={s.card}>{draft.rawText ? <Text style={[s.confidence,(!draft.storeName||!draft.date||!draft.amount)&&s.low]}>{!draft.storeName||!draft.date||!draft.amount?'未入力の項目があります。確認してください。':'画像と照らし合わせて内容を確認してください。'}</Text>:null}
      {draft.warnings?.map(w=><Text key={w} style={s.warning}>{w}</Text>)}
      <Field label="店舗名" value={draft.storeName} onChange={v=>set('storeName',v)} required/><Field label="日付（例：2026-09-10）" value={draft.date} onChange={v=>set('date',v)} required/><Field label="金額（円）" value={draft.amount} onChange={v=>set('amount',v)} numeric required/><Field label="支払方法" value={draft.paymentMethod} onChange={v=>set('paymentMethod',v)}/><Field label="メモ" value={draft.note} onChange={v=>set('note',v)}/>
      {!draft.amount&&draft.amountCandidates?.length?<><Text style={s.label}>金額候補</Text><View style={s.chips}>{draft.amountCandidates.map(a=><Chip key={a} label={yen(Number(a))} active={false} onPress={()=>set('amount',a)}/>)}</View></>:null}
      <Text style={s.label}>カテゴリ</Text><View style={s.chips}>{categories.map(c=><Chip key={c} label={c} active={draft.category===c} onPress={()=>set('category',c)}/>)}</View>
      <Text style={s.label}>画像の種類</Text><View style={s.quickRow}><Chip label="紙レシート" active={draft.sourceType==='receipt'} onPress={()=>setDraft({...draft,sourceType:'receipt'})}/><Chip label="決済画面" active={draft.sourceType==='payment_screenshot'} onPress={()=>setDraft({...draft,sourceType:'payment_screenshot'})}/></View>
      {imageUri&&!editing?<Text style={s.help}>画像は確認用です。保存されるのは支出情報です。</Text>:null}
      <Pressable style={s.primary} onPress={submit}><Text style={s.primaryText}>確認して保存</Text></Pressable><Pressable onPress={editing?reset:cancel}><Text style={s.cancel}>{editing?'編集をキャンセル':'入力をキャンセル'}</Text></Pressable></View>}
  </>;
}

function History({month,setMonth,all,setAll,query,setQuery,filter,setFilter,categories,items,edit,remove}:{month:string;setMonth:(m:string)=>void;all:boolean;setAll:(v:boolean)=>void;query:string;setQuery:(q:string)=>void;filter:string;setFilter:(f:string)=>void;categories:string[];items:Expense[];edit:(e:Expense)=>void;remove:(id:string)=>void}) {
  return <><View style={s.quickRow}><Chip label={`全期間 (${items.length}件)`} active={all} onPress={()=>setAll(true)}/><Chip label="月別表示" active={!all} onPress={()=>setAll(false)}/></View>{!all&&<MonthNav month={month} setMonth={setMonth}/>}<TextInput style={s.search} placeholder="店舗・メモ・支払方法を検索" value={query} onChangeText={setQuery}/><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}><Chip label="すべて" active={filter==='すべて'} onPress={()=>setFilter('すべて')}/>{categories.map(c=><Chip key={c} label={c} active={filter===c} onPress={()=>setFilter(c)}/>)}</ScrollView>
    {items.length?items.map(item=><View key={item.id} style={s.expense}><Pressable style={{flex:1}} onPress={()=>edit(item)}><Text style={s.expenseStore}>{item.storeName}</Text><Text style={s.expenseMeta}>{item.date} · {item.category} · {item.paymentMethod}</Text></Pressable><View style={s.amountSide}><Text style={s.expenseAmount}>{yen(Number(item.amount))}</Text><Pressable onPress={()=>remove(item.id)}><Text style={s.delete}>削除</Text></Pressable></View></View>):<Empty text={all?'保存した支出はありません。':'この月の支出はありません。'}/>}</>;
}

function Stats({month,setMonth,total,categories}:{month:string;setMonth:(m:string)=>void;total:number;categories:{name:string;value:number}[]}) { return <><MonthNav month={month} setMonth={setMonth}/><View style={s.card}><Text style={s.statTotal}>合計 {yen(total)}</Text>{categories.length?categories.map(x=><Bar key={x.name} {...x} max={total}/>):<Empty text="グラフに表示するデータがありません。"/>}</View></>; }

function Settings({settings,update,newCategory,setNewCategory}:{settings:AppSettings;update:(s:AppSettings)=>void;newCategory:string;setNewCategory:(v:string)=>void}) {
  const [budget,setBudget]=useState(String(settings.monthlyBudget));
  const saveBudget=()=>{const n=Number(budget);if(n>=0)update({...settings,monthlyBudget:n});};
  const add=()=>{const c=newCategory.trim();if(c&&!settings.categories.includes(c)){update({...settings,categories:[...settings.categories,c]});setNewCategory('');}};
  return <><Title text="設定"/><View style={s.card}><Field label="月間予算 (円)" value={budget} onChange={setBudget} numeric/><Pressable style={s.secondaryButton} onPress={saveBudget}><Text style={s.secondaryText}>予算を保存</Text></Pressable></View><Title text="AI補助"/><View style={s.card}><View style={s.settingRow}><View style={{flex:1}}><Text style={s.settingTitle}>低信頼度の場合のみ利用</Text><Text style={s.settingHelp}>有効時も、結果は必ず保存前に確認します。サーバーURLの設定が必要です。</Text></View><Switch value={settings.aiFallbackEnabled} onValueChange={v=>update({...settings,aiFallbackEnabled:v})}/></View></View><Title text="カテゴリ管理"/><View style={s.card}><View style={s.inline}><TextInput style={[s.input,{flex:1}]} placeholder="新しいカテゴリ" value={newCategory} onChangeText={setNewCategory}/><Pressable style={s.smallButton} onPress={add}><Text style={s.primaryText}>追加</Text></Pressable></View>{settings.categories.map(c=><View key={c} style={s.settingRow}><Text>{c}</Text>{c!=='その他'&&<Pressable onPress={()=>update({...settings,categories:settings.categories.filter(x=>x!==c)})}><Text style={s.delete}>削除</Text></Pressable>}</View>)}</View></>;
}

function MonthNav({month,setMonth}:{month:string;setMonth:(m:string)=>void}) { return <View style={s.monthNav}><Pressable onPress={()=>setMonth(shiftMonth(month,-1))}><Text style={s.monthArrow}>‹</Text></Pressable><Text style={s.monthTitle}>{monthLabel(month)}</Text><Pressable onPress={()=>setMonth(shiftMonth(month,1))}><Text style={s.monthArrow}>›</Text></Pressable></View>; }
function Field({label,value,onChange,numeric=false,required=false}:{label:string;value:string;onChange:(v:string)=>void;numeric?:boolean;required?:boolean}) { return <View style={s.field}><Text style={s.label}>{label}{required&&!value.trim()?'（入力が必要です）':''}</Text><TextInput accessibilityLabel={label} style={[s.input,required&&!value.trim()&&{borderColor:'#c06030'}]} value={value} onChangeText={onChange} keyboardType={numeric?'numeric':'default'}/></View>; }
function Title({text}:{text:string}) { return <Text style={s.title}>{text}</Text>; }
function Quick({label,onPress,secondary=false}:{label:string;onPress:()=>void;secondary?:boolean}) { return <Pressable style={[s.quick,secondary&&s.quickSecondary]} onPress={onPress}><Text style={[s.quickText,secondary&&s.quickTextSecondary]}>{label}</Text></Pressable>; }
function Chip({label,active,onPress}:{label:string;active:boolean;onPress:()=>void}) { return <Pressable style={[s.chip,active&&s.chipActive]} onPress={onPress}><Text style={[s.chipText,active&&s.chipTextActive]}>{label}</Text></Pressable>; }
function Bar({name,value,max}:{name:string;value:number;max:number}) { return <View style={s.barRow}><View style={s.barLabels}><Text style={s.barName}>{name}</Text><Text style={s.barValue}>{yen(value)}</Text></View><View style={s.barTrack}><View style={[s.barFill,{width:`${max?Math.max(value/max*100,4):0}%`}]} /></View></View>; }
function Empty({text}:{text:string}) { return <Text style={s.empty}>{text}</Text>; }

const s=StyleSheet.create({
  safe:{flex:1,backgroundColor:'#f4f7f5'},header:{paddingHorizontal:20,paddingTop:14,paddingBottom:10,flexDirection:'row',justifyContent:'space-between',alignItems:'center',borderBottomWidth:1,borderBottomColor:'#e2e9e6'},logo:{fontSize:23,fontWeight:'900',color:'#153e36'},headerMonth:{color:'#60746f',fontWeight:'700'},page:{width:'100%',maxWidth:720,alignSelf:'center',padding:20,paddingBottom:30},navSafe:{backgroundColor:'white'},nav:{flexDirection:'row',backgroundColor:'white',borderTopWidth:1,borderTopColor:'#dbe5e1'},navItem:{flex:1,alignItems:'center',paddingVertical:13},navText:{fontSize:12,color:'#71807d',fontWeight:'700'},navActive:{color:'#0f766e'},eyebrow:{color:'#0f766e',fontWeight:'800',letterSpacing:1,marginBottom:8},hero:{backgroundColor:'#123b35',borderRadius:22,padding:23},heroAmount:{color:'white',fontSize:38,fontWeight:'900'},heroMeta:{color:'#b8ddd5',marginTop:5},progress:{height:8,backgroundColor:'#315952',borderRadius:9,marginTop:18,overflow:'hidden'},progressFill:{height:'100%',backgroundColor:'#f38b56'},quickRow:{flexDirection:'row',gap:10,marginVertical:14},quick:{flex:1,backgroundColor:'#0f766e',padding:15,borderRadius:13,alignItems:'center'},quickSecondary:{backgroundColor:'#dceae6'},quickText:{color:'white',fontWeight:'800'},quickTextSecondary:{color:'#0f665e'},title:{fontSize:21,fontWeight:'900',color:'#193b35',marginTop:18,marginBottom:12},help:{color:'#60746f',lineHeight:21},warning:{backgroundColor:'#fff3e8',color:'#945027',padding:12,borderRadius:10,marginBottom:10},preview:{height:220,width:'100%',backgroundColor:'#e4ebe8',borderRadius:15},loader:{margin:30},card:{backgroundColor:'white',padding:17,borderRadius:18,marginBottom:15},field:{marginBottom:12},label:{fontSize:13,fontWeight:'800',color:'#50635f',marginBottom:5},input:{borderWidth:1,borderColor:'#d7e2de',backgroundColor:'#f7f9f8',borderRadius:10,padding:12,fontSize:16},chips:{flexDirection:'row',flexWrap:'wrap',gap:7,marginBottom:12},chip:{borderWidth:1,borderColor:'#b9cbc6',paddingVertical:9,paddingHorizontal:12,borderRadius:20},chipActive:{backgroundColor:'#d9f1ea',borderColor:'#0f766e'},chipText:{color:'#63736f'},chipTextActive:{color:'#0f665e',fontWeight:'800'},primary:{backgroundColor:'#eb6b35',padding:16,borderRadius:12,alignItems:'center',marginTop:14},primaryText:{color:'white',fontWeight:'900'},cancel:{textAlign:'center',color:'#71807d',marginTop:15},confidence:{backgroundColor:'#e1f4ed',color:'#0f665e',padding:10,borderRadius:9,marginBottom:13,fontWeight:'800'},low:{backgroundColor:'#fff0df',color:'#9a4e19'},monthNav:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',marginBottom:15},monthArrow:{fontSize:38,color:'#0f766e',paddingHorizontal:18},monthTitle:{fontSize:22,fontWeight:'900',color:'#193b35'},search:{backgroundColor:'white',borderWidth:1,borderColor:'#d7e2de',borderRadius:12,padding:13,fontSize:15},expense:{backgroundColor:'white',padding:15,borderRadius:13,marginBottom:9,flexDirection:'row',alignItems:'center'},expenseStore:{fontWeight:'900',fontSize:16,color:'#1d342f'},expenseMeta:{color:'#71807d',fontSize:12,marginTop:4},amountSide:{alignItems:'flex-end',marginLeft:10},expenseAmount:{fontWeight:'900',fontSize:17,color:'#173f38'},delete:{color:'#b54832',fontWeight:'700',fontSize:12,marginTop:6},statTotal:{fontWeight:'900',fontSize:24,color:'#173f38',marginBottom:18},barRow:{marginBottom:14},barLabels:{flexDirection:'row',justifyContent:'space-between'},barName:{fontWeight:'800',color:'#38514c'},barValue:{fontWeight:'800',color:'#38514c'},barTrack:{height:9,backgroundColor:'#e0e8e5',borderRadius:8,marginTop:7,overflow:'hidden'},barFill:{height:'100%',backgroundColor:'#20a486',borderRadius:8},empty:{color:'#71807d',textAlign:'center',paddingVertical:25},inline:{flexDirection:'row',gap:8,alignItems:'center'},smallButton:{backgroundColor:'#0f766e',padding:13,borderRadius:10},secondaryButton:{backgroundColor:'#dceae6',padding:13,borderRadius:10,alignItems:'center'},secondaryText:{color:'#0f665e',fontWeight:'900'},settingRow:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',gap:12,paddingVertical:12,borderBottomWidth:1,borderBottomColor:'#edf1ef'},settingTitle:{fontWeight:'800',color:'#28443e'},settingHelp:{fontSize:12,color:'#71807d',marginTop:4,lineHeight:17}
});
