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
  const [captureEntry,setCaptureEntry]=useState<'camera'|'gallery'|'review'>('camera');
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
  const chooseImage = (camera:boolean) => {if(!busy.current) {setCaptureEntry(imageUri?'review':camera?'camera':'gallery');setCaptureVisible(true);}};
  const openCamera = () => { if(!busy.current) { setCaptureEntry('camera'); setCaptureVisible(true); } };
  const openGallery = () => { if(!busy.current) { setCaptureEntry('gallery'); setCaptureVisible(true); } };
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
    <View style={s.header}>
      <Text style={s.logo}>ReceiptLog</Text>
      <View style={s.headerBadge}>
        <Text style={s.headerBadgeText}>家計簿</Text>
      </View>
    </View>
    <ScrollView contentContainerStyle={s.page} keyboardShouldPersistTaps="handled">
      {tab === 'home' && <Home month={month} setMonth={setMonth} total={total} budget={settings.monthlyBudget} count={monthly.length} categories={categories} recent={expenses.slice(0,3)} setTab={setTab} />}
      {tab === 'add' && <Add draft={draft} setDraft={setDraft} imageUri={imageUri} processing={processing || saving} editing={Boolean(editingId)} categories={settings.categories} chooseImage={chooseImage} submit={()=>void submit()} reset={cancelCapture} cancel={cancelCapture} pendingCount={pending.length} skip={!processing&&!saving&&imageUri&&!editingId?()=>advance():undefined} />}
      {tab === 'history' && <History month={month} setMonth={setMonth} all={historyAll} setAll={setHistoryAll} query={query} setQuery={setQuery} filter={categoryFilter} setFilter={setCategoryFilter} categories={settings.categories} items={filtered} edit={edit} remove={remove} />}
      {tab === 'stats' && <Stats month={month} setMonth={setMonth} total={total} categories={categories} />}
      {tab === 'settings' && <Settings settings={settings} update={updateSettings} newCategory={newCategory} setNewCategory={setNewCategory} />}
    </ScrollView>
    <View style={s.fabContainer} pointerEvents="box-none">
      <Pressable accessibilityLabel="カメラで撮影" style={s.fabButton} onPress={openCamera}>
        <FabIcon kind="camera" />
      </Pressable>
      <Pressable accessibilityLabel="写真を選択" style={[s.fabButton, s.fabGallery]} onPress={openGallery}>
        <FabIcon kind="photo" />
      </Pressable>
    </View>
    <SafeAreaView style={s.navSafe} edges={['bottom']}><View style={s.nav}>{([['home','ホーム'],['history','履歴'],['stats','分析'],['settings','設定']] as [Tab,string][]).map(([key,label]) => <Pressable key={key} style={s.navItem} onPress={() => { if(busy.current) return; setTab(key); }}><Text style={[s.navText, tab === key && s.navActive]}>{label}</Text>{tab===key&&<View style={s.navDot}/>}</Pressable>)}</View></SafeAreaView>
    <CaptureFlow key={captureSession} visible={captureVisible} entry={captureEntry} focusUri={imageUri} onClose={()=>setCaptureVisible(false)} onDiscard={resetForm} onComplete={acceptImages} aiEnabled={settings.aiFallbackEnabled} onDirty={setCaptureDirty}/>
  </SafeAreaView></SafeAreaProvider>;
}

function Home({ month, setMonth, total, budget, count, categories, recent, setTab }: { month:string; setMonth:(m:string)=>void; total:number; budget:number; count:number; categories:{name:string;value:number}[]; recent:Expense[]; setTab:(t:Tab)=>void }) {
  const left = budget - total, ratio = budget ? Math.min(total / budget, 1) : 0;
  return <><MonthNav month={month} setMonth={setMonth}/><Text style={s.eyebrow}>{monthLabel(month)}の概要</Text><View style={s.hero}><Text style={s.heroTag}>今月の支出合計</Text><Text style={s.heroAmount}>{yen(total)}</Text><Text style={s.heroMeta}>{count}件の取引 · 予算残り {yen(left)}</Text><View style={s.progress}><View style={[s.progressFill,{width:`${Math.min(ratio*100, 100)}%`}]} /></View></View>
    <View style={s.quickRow}><Quick label="手入力で追加" onPress={()=>setTab('add')} secondary/><Quick label="履歴を見る" onPress={()=>setTab('history')} secondary/></View>
    <Title text="カテゴリ別" />
    <View style={s.card}>
      {categories.length ? categories.slice(0,5).map((x)=><Bar key={x.name} {...x} max={total}/>) : <Empty text="この月の支出はまだありません。" />}
    </View>
    <Title text="最近保存した支出" />
    {recent.length ? recent.map(item=>(
      <View key={item.id} style={s.expense}>
        <View style={{flex:1}}>
          <Text style={s.expenseStore}>{item.storeName}</Text>
          <View style={s.badgeRow}>
            <Text style={s.expenseMeta}>{item.date}</Text>
            <View style={s.categoryBadge}><Text style={s.categoryBadgeText}>{item.category}</Text></View>
          </View>
        </View>
        <Text style={s.expenseAmount}>{yen(Number(item.amount))}</Text>
      </View>
    )) : <Empty text="保存した支出はありません。"/>}</>;
}

function Add({draft,setDraft,imageUri,processing,editing,categories,chooseImage,submit,reset,cancel,pendingCount,skip}:{draft:ExpenseDraft;setDraft:(d:ExpenseDraft)=>void;imageUri?:string;processing:boolean;editing:boolean;categories:string[];chooseImage:(c:boolean)=>void;submit:()=>void;reset:()=>void;cancel:()=>void;pendingCount:number;skip?:()=>void}) {
  const set=(key:keyof ExpenseDraft,value:string)=>setDraft({...draft,[key]:value});
  const [showOcrDump, setShowOcrDump] = useState(false);
  const [showOptional, setShowOptional] = useState(false);
  const isComplete = Boolean(draft.storeName.trim() && draft.date.trim() && draft.amount.trim());

  return <View style={s.addContainer}>
    <View style={s.addHeading}><View><Text style={s.addTitle}>{editing?'編集':imageUri?'内容を確認':'手入力'}</Text>{pendingCount>0&&<Text style={s.batchNote}>残り {pendingCount}件</Text>}</View>{skip&&<Pressable accessibilityRole="button" onPress={skip} style={s.skipButton}><Text style={s.skipText}>スキップ →</Text></Pressable>}</View>

    {!editing && !imageUri && <View style={s.quickRow}>
      <Quick label="写真を撮る" onPress={()=>chooseImage(true)}/>
      <Quick label="画像を選択" onPress={()=>chooseImage(false)} secondary/>
    </View>}

    {Platform.OS === 'web' && <Text style={s.warning}>ブラウザー版では手入力できます。画像の読み取りはスマートフォン版で利用してください。</Text>}

    {imageUri && <View style={s.imageCard}>
      <Image source={{uri:imageUri}} style={s.compactPreview} resizeMode="cover"/>
      <View style={s.imageCardInfo}>
        <Text style={s.imageCardTitle}>{draft.storeName || '店舗名未入力'}</Text>
        <Text style={s.imageCardAmount}>{draft.amount ? yen(Number(draft.amount)) : '金額未入力'}</Text>
        {!editing && <Pressable style={s.compactButton} onPress={()=>chooseImage(true)}>
          <Text style={s.compactButtonText}>📷 画像を調整・撮り直す</Text>
        </Pressable>}
      </View>
    </View>}

    {processing && <View style={s.card}>
      <ActivityIndicator style={s.loader} color="#0f766e" size="large"/>
      <Pressable style={s.secondaryButton} onPress={cancel}>
        <Text style={s.secondaryText}>OCRをキャンセル</Text>
      </Pressable>
    </View>}

    {!processing && <View style={s.card}>
      {draft.rawText && !isComplete ? <Text style={s.formNotice}>未入力の項目を確認してください。</Text> : null}

      {draft.warnings?.map(w=><Text key={w} style={s.formNotice}>{w}</Text>)}

      <Field label="店舗名" value={draft.storeName} onChange={v=>set('storeName',v)} required/>

      <View style={s.fieldRow}>
        <View style={s.halfField}>
          <Field label="日付" value={draft.date} onChange={v=>set('date',v)} required/>
        </View>
        <View style={s.halfField}>
          <Field label="金額 (円)" value={draft.amount} onChange={v=>set('amount',v)} numeric required attention={Boolean(draft.amount&&draft.fieldConfidence&&draft.fieldConfidence.amount<0.6)}/>
        </View>
      </View>

      {draft.amountCandidates && draft.amountCandidates.length > 0 && <View style={{marginBottom: 10}}>
        <Text style={s.subLabel}>金額候補（タップで選択）</Text>
        <View style={s.chips}>
          {draft.amountCandidates.map(a=>(
            <Chip key={a} label={yen(Number(a))} active={draft.amount===a} onPress={()=>set('amount',a)}/>
          ))}
        </View>
      </View>}

      <Text style={s.label}>カテゴリ</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chipStrip}>
        {categories.map(c=><Chip key={c} label={c} active={draft.category===c} onPress={()=>set('category',c)}/>)}
      </ScrollView>

      <Pressable accessibilityRole="button" style={[s.primary,!isComplete&&s.primaryDisabled]} onPress={submit}>
        <Text style={s.primaryText}>{editing?'変更を保存':'この内容で保存'}</Text>
      </Pressable>

      <Pressable accessibilityRole="button" style={s.disclosure} onPress={()=>setShowOptional(!showOptional)}>
        <View><Text style={s.disclosureTitle}>支払方法・メモなど</Text><Text style={s.disclosureSummary}>{draft.paymentMethod || '未設定'}{draft.note ? ` · ${draft.note}` : ' · 任意'}</Text></View>
        <Text style={s.disclosureArrow}>{showOptional?'▲':'▼'}</Text>
      </Pressable>
      {showOptional && <View style={s.optionalPanel}>
        <View style={s.fieldRow}>
          <View style={s.halfField}><Field label="支払方法" value={draft.paymentMethod} onChange={v=>set('paymentMethod',v)}/></View>
          <View style={s.halfField}><Field label="メモ" value={draft.note} onChange={v=>set('note',v)}/></View>
        </View>
        <Text style={s.label}>画像の種類</Text>
        <View style={s.chips}>
          <Chip label="紙レシート" active={draft.sourceType==='receipt'} onPress={()=>setDraft({...draft,sourceType:'receipt'})}/>
          <Chip label="決済画面" active={draft.sourceType==='payment_screenshot'} onPress={()=>setDraft({...draft,sourceType:'payment_screenshot'})}/>
        </View>
      </View>}

      <Pressable onPress={editing?reset:cancel}>
        <Text style={s.cancel}>{editing?'編集をキャンセル':'入力をキャンセル'}</Text>
      </Pressable>

      <View style={s.debugSection}>
        <Pressable style={s.debugHeader} onPress={() => setShowOcrDump(!showOcrDump)}>
          <Text style={s.debugHeaderText}>🔍 OCR ダンプ (デバッグ情報) {showOcrDump ? '▲' : '▼'}</Text>
        </Pressable>
        {showOcrDump && <View style={s.debugContent}>
          <Text style={s.debugMeta}>信頼度: {Math.round((draft.confidence ?? 0) * 100)}% | 種別: {draft.sourceType}</Text>
          {draft.amountCandidates?.length ? <Text style={s.debugMeta}>金額候補: {draft.amountCandidates.join(', ')}</Text> : null}
          <Text style={s.debugTextLabel}>抽出テキスト (Raw Text):</Text>
          <ScrollView style={s.debugScroll} nestedScrollEnabled>
            <Text style={s.debugText}>{draft.rawText || '(テキストは抽出されていません)'}</Text>
          </ScrollView>
        </View>}
      </View>
    </View>}
  </View>;
}

function History({month,setMonth,all,setAll,query,setQuery,filter,setFilter,categories,items,edit,remove}:{month:string;setMonth:(m:string)=>void;all:boolean;setAll:(v:boolean)=>void;query:string;setQuery:(q:string)=>void;filter:string;setFilter:(f:string)=>void;categories:string[];items:Expense[];edit:(e:Expense)=>void;remove:(id:string)=>void}) {
  return <>
    <View style={s.quickRow}>
      <Chip label={`全期間 (${items.length}件)`} active={all} onPress={()=>setAll(true)}/>
      <Chip label="月別表示" active={!all} onPress={()=>setAll(false)}/>
    </View>
    {!all && <MonthNav month={month} setMonth={setMonth}/>}
    <TextInput style={s.search} placeholder="🔍 店舗・メモ・支払方法を検索" placeholderTextColor="#8C9B94" value={query} onChangeText={setQuery}/>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chipStrip}>
      <Chip label="すべて" active={filter==='すべて'} onPress={()=>setFilter('すべて')}/>
      {categories.map(c=><Chip key={c} label={c} active={filter===c} onPress={()=>setFilter(c)}/>)}
    </ScrollView>
    {items.length ? items.map(item=>(
      <View key={item.id} style={s.expense}>
        <Pressable style={{flex:1}} onPress={()=>edit(item)}>
          <Text style={s.expenseStore}>{item.storeName}</Text>
          <View style={s.badgeRow}>
            <Text style={s.expenseMeta}>{item.date} · {item.paymentMethod || '未設定'}</Text>
            <View style={s.categoryBadge}><Text style={s.categoryBadgeText}>{item.category}</Text></View>
          </View>
        </Pressable>
        <View style={s.amountSide}>
          <Text style={s.expenseAmount}>{yen(Number(item.amount))}</Text>
          <Pressable onPress={()=>remove(item.id)}>
            <Text style={s.delete}>削除</Text>
          </Pressable>
        </View>
      </View>
    )) : <Empty text={all?'保存した支出はありません。':'この月の支出はありません。'}/>}
  </>;
}

function Stats({month,setMonth,total,categories}:{month:string;setMonth:(m:string)=>void;total:number;categories:{name:string;value:number}[]}) {
  return <>
    <MonthNav month={month} setMonth={setMonth}/>
    <Text style={s.eyebrow}>{monthLabel(month)}の分析</Text>
    <View style={s.card}>
      <Text style={s.statLabel}>月間支出合計</Text>
      <Text style={s.statTotal}>{yen(total)}</Text>
      {categories.length ? (
        <View style={{marginTop: 12}}>
          {categories.map(x=><Bar key={x.name} {...x} max={total}/>)}
        </View>
      ) : <Empty text="表示するデータがありません。" />}
    </View>
  </>;
}

function Settings({settings,update,newCategory,setNewCategory}:{settings:AppSettings;update:(s:AppSettings)=>void;newCategory:string;setNewCategory:(v:string)=>void}) {
  const [budget,setBudget]=useState(String(settings.monthlyBudget));
  const saveBudget=()=>{const n=Number(budget);if(n>=0)update({...settings,monthlyBudget:n});};
  const add=()=>{const c=newCategory.trim();if(c&&!settings.categories.includes(c)){update({...settings,categories:[...settings.categories,c]});setNewCategory('');}};
  return <>
    <Title text="設定"/>
    <View style={s.card}>
      <Field label="月間予算 (円)" value={budget} onChange={setBudget} numeric/>
      <Pressable style={s.secondaryButton} onPress={saveBudget}>
        <Text style={s.secondaryText}>予算を保存</Text>
      </Pressable>
    </View>

    <Title text="AI補助機能"/>
    <View style={s.card}>
      <View style={s.settingRow}>
        <View style={{flex:1}}>
          <Text style={s.settingTitle}>低信頼度の場合のみ利用</Text>
          <Text style={s.settingHelp}>有効時も、結果は必ず保存前に確認します。サーバーURLの設定が必要です。</Text>
        </View>
        <Switch
          trackColor={{ false: '#D2DCD6', true: colors.primary }}
          thumbColor={settings.aiFallbackEnabled ? colors.accent : '#FFFFFF'}
          value={settings.aiFallbackEnabled}
          onValueChange={v=>update({...settings,aiFallbackEnabled:v})}
        />
      </View>
    </View>

    <Title text="カテゴリ管理"/>
    <View style={s.card}>
      <View style={[s.inline, {marginBottom: 12}]}>
        <TextInput style={[s.input,{flex:1}]} placeholder="新しいカテゴリ名" placeholderTextColor="#8C9B94" value={newCategory} onChangeText={setNewCategory}/>
        <Pressable style={s.smallButton} onPress={add}>
          <Text style={s.primaryText}>追加</Text>
        </Pressable>
      </View>
      {settings.categories.map(c=>(
        <View key={c} style={s.settingRow}>
          <Text style={{fontWeight: '700', color: colors.text}}>{c}</Text>
          {c!=='その他' && (
            <Pressable onPress={()=>update({...settings,categories:settings.categories.filter(x=>x!==c)})}>
              <Text style={s.delete}>削除</Text>
            </Pressable>
          )}
        </View>
      ))}
    </View>
  </>;
}

function MonthNav({month,setMonth}:{month:string;setMonth:(m:string)=>void}) { return <View style={s.monthNav}><Pressable onPress={()=>setMonth(shiftMonth(month,-1))}><Text style={s.monthArrow}>‹</Text></Pressable><Text style={s.monthTitle}>{monthLabel(month)}</Text><Pressable onPress={()=>setMonth(shiftMonth(month,1))}><Text style={s.monthArrow}>›</Text></Pressable></View>; }
function Field({label,value,onChange,numeric=false,required=false,attention=false}:{label:string;value:string;onChange:(v:string)=>void;numeric?:boolean;required?:boolean;attention?:boolean}) { return <View style={s.field}><Text style={s.label}>{label}{required&&!value.trim()?'（入力が必要です）':''}{attention?'（要確認）':''}</Text><TextInput accessibilityLabel={label} style={[s.input,(required&&!value.trim()||attention)&&s.inputAttention]} value={value} onChangeText={onChange} keyboardType={numeric?'numeric':'default'} placeholderTextColor="#8C9B94"/></View>; }
function Title({text}:{text:string}) { return <Text style={s.title}>{text}</Text>; }
function Quick({label,onPress,secondary=false}:{label:string;onPress:()=>void;secondary?:boolean}) { return <Pressable style={[s.quick,secondary&&s.quickSecondary]} onPress={onPress}><Text style={[s.quickText,secondary&&s.quickTextSecondary]}>{label}</Text></Pressable>; }
function Chip({label,active,onPress}:{label:string;active:boolean;onPress:()=>void}) { return <Pressable style={[s.chip,active&&s.chipActive]} onPress={onPress}><Text style={[s.chipText,active&&s.chipTextActive]}>{label}</Text></Pressable>; }
function Bar({name,value,max}:{name:string;value:number;max:number}) {
  const pct = max ? Math.round((value / max) * 100) : 0;
  return (
    <View style={s.barRow}>
      <View style={s.barLabels}>
        <View style={s.barNameContainer}>
          <Text style={s.barName}>{name}</Text>
          <Text style={s.barPct}>{pct}%</Text>
        </View>
        <Text style={s.barValue}>{yen(value)}</Text>
      </View>
      <View style={s.barTrack}>
        <View style={[s.barFill,{width:`${max?Math.max(value/max*100,4):0}%`}]} />
      </View>
    </View>
  );
}
function Empty({text}:{text:string}) { return <Text style={s.empty}>{text}</Text>; }
function FabIcon({kind}:{kind:'camera'|'photo'}) { return kind==='camera' ? <View style={s.cameraIcon}><View style={s.cameraTop}/><View style={s.cameraLens}/></View> : <View style={s.photoIcon}><View style={s.photoSun}/><View style={s.photoMountainLeft}/><View style={s.photoMountainRight}/></View>; }

const colors = {
  bg: '#F2F5F3',
  cardBg: '#FFFFFF',
  cardBorder: '#E1E8E4',
  heroBg: '#2A3A34',
  heroText: '#FFFFFF',
  heroSub: '#B8C9C1',
  heroProgressTrack: '#3D5049',
  heroProgressFill: '#E07A5F',
  primary: '#2A3A34',
  accent: '#E07A5F',
  text: '#1A2521',
  textMuted: '#6D7C75',
  softGreenBg: '#E8F0EC',
  softGreenText: '#234438',
  chipActiveBg: '#2A3A34',
  chipActiveText: '#FFFFFF',
  chipInactiveBg: '#FFFFFF',
  chipInactiveBorder: '#D2DCD6',
  chipInactiveText: '#4A5B53',
  barTrack: '#E6EEE9',
  barFill: '#507C6C',
  warningBg: '#FFF4ED',
  warningText: '#B8502E',
  navBg: '#FFFFFF',
  navBorder: '#E2E8E4',
  navActive: '#2A3A34',
  navInactive: '#8C9B94',
  fabCamera: '#2A3A34',
  fabGallery: '#FFFFFF'
};

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  logo: { fontSize: 22, fontWeight: '900', color: colors.text, letterSpacing: -0.5 },
  headerBadge: { backgroundColor: colors.softGreenBg, paddingVertical: 4, paddingHorizontal: 10, borderRadius: 12, borderWidth: 1, borderColor: colors.cardBorder },
  headerBadgeText: { fontSize: 12, fontWeight: '800', color: colors.softGreenText },
  heroTag: { color: colors.heroSub, fontSize: 13, fontWeight: '700', marginBottom: 2 },
  page: { width: '100%', maxWidth: 720, alignSelf: 'center', padding: 20, paddingBottom: 110 },
  navSafe: { backgroundColor: colors.navBg },
  nav: { flexDirection: 'row', backgroundColor: colors.navBg, borderTopWidth: 1, borderTopColor: colors.navBorder },
  navItem: { flex: 1, alignItems: 'center', paddingTop: 13, paddingBottom: 10, gap: 5 },
  navText: { fontSize: 12, color: colors.navInactive, fontWeight: '700' },
  navActive: { color: colors.navActive },
  navDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: colors.navActive },
  eyebrow: { color: colors.accent, fontWeight: '800', letterSpacing: 0.8, fontSize: 13, marginBottom: 8 },
  hero: { backgroundColor: colors.heroBg, borderRadius: 24, padding: 24, borderWidth: 1, borderColor: colors.cardBorder, shadowColor: '#1A2521', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.08, shadowRadius: 12, elevation: 3 },
  heroAmount: { color: colors.heroText, fontSize: 38, fontWeight: '900', letterSpacing: -0.5 },
  heroMeta: { color: colors.heroSub, marginTop: 6, fontSize: 14, fontWeight: '600' },
  progress: { height: 10, backgroundColor: colors.heroProgressTrack, borderRadius: 10, marginTop: 18, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: colors.heroProgressFill, borderRadius: 10 },
  quickRow: { flexDirection: 'row', gap: 10, marginVertical: 14 },
  quick: { flex: 1, backgroundColor: colors.primary, padding: 14, borderRadius: 16, alignItems: 'center' },
  quickSecondary: { backgroundColor: colors.softGreenBg, borderWidth: 1, borderColor: colors.cardBorder },
  quickText: { color: colors.heroText, fontWeight: '800', fontSize: 14 },
  quickTextSecondary: { color: colors.softGreenText, fontWeight: '800', fontSize: 14 },
  title: { fontSize: 20, fontWeight: '900', color: colors.text, marginTop: 22, marginBottom: 12, letterSpacing: -0.3 },
  help: { color: colors.textMuted, lineHeight: 21 },
  warning: { backgroundColor: colors.warningBg, color: colors.warningText, padding: 12, borderRadius: 12, marginBottom: 10, borderWidth: 1, borderColor: '#F5D7C8' },
  preview: { height: 220, width: '100%', backgroundColor: colors.softGreenBg, borderRadius: 16 },
  loader: { margin: 30 },
  card: { backgroundColor: colors.cardBg, padding: 18, borderRadius: 20, marginBottom: 15, borderWidth: 1, borderColor: colors.cardBorder, shadowColor: '#1A2521', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.03, shadowRadius: 8, elevation: 1 },
  field: { marginBottom: 12 },
  label: { fontSize: 13, fontWeight: '800', color: colors.textMuted, marginBottom: 6 },
  input: { borderWidth: 1, borderColor: colors.cardBorder, backgroundColor: colors.bg, borderRadius: 12, padding: 13, fontSize: 16, color: colors.text },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  chipStrip: { gap: 8, paddingBottom: 12 },
  chip: { borderWidth: 1, borderColor: colors.chipInactiveBorder, backgroundColor: colors.chipInactiveBg, paddingVertical: 8, paddingHorizontal: 14, borderRadius: 20 },
  chipActive: { backgroundColor: colors.chipActiveBg, borderColor: colors.chipActiveBg },
  chipText: { color: colors.chipInactiveText, fontSize: 13, fontWeight: '600' },
  chipTextActive: { color: colors.chipActiveText, fontWeight: '800' },
  primary: { backgroundColor: colors.accent, padding: 16, borderRadius: 16, alignItems: 'center', marginTop: 8 },
  primaryText: { color: 'white', fontWeight: '900', fontSize: 15 },
  cancel: { textAlign: 'center', color: colors.textMuted, marginTop: 15, fontWeight: '700' },
  confidence: { backgroundColor: colors.softGreenBg, color: colors.softGreenText, padding: 10, borderRadius: 10, marginBottom: 13, fontWeight: '800' },
  low: { backgroundColor: colors.warningBg, color: colors.warningText },
  monthNav: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, backgroundColor: colors.cardBg, paddingVertical: 10, paddingHorizontal: 16, borderRadius: 20, borderWidth: 1, borderColor: colors.cardBorder },
  monthArrow: { fontSize: 28, color: colors.primary, paddingHorizontal: 12, fontWeight: '800' },
  monthTitle: { fontSize: 18, fontWeight: '900', color: colors.text },
  search: { backgroundColor: colors.cardBg, borderWidth: 1, borderColor: colors.cardBorder, borderRadius: 14, padding: 13, fontSize: 15, color: colors.text, marginBottom: 12 },
  expense: { backgroundColor: colors.cardBg, padding: 16, borderRadius: 16, marginBottom: 10, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: colors.cardBorder },
  expenseStore: { fontWeight: '900', fontSize: 16, color: colors.text },
  expenseMeta: { color: colors.textMuted, fontSize: 12, marginTop: 4 },
  amountSide: { alignItems: 'flex-end', marginLeft: 10 },
  expenseAmount: { fontWeight: '900', fontSize: 17, color: colors.text },
  delete: { color: colors.accent, fontWeight: '700', fontSize: 12, marginTop: 6 },
  statLabel: { fontSize: 13, fontWeight: '700', color: colors.textMuted, marginBottom: 4 },
  statTotal: { fontWeight: '900', fontSize: 28, color: colors.text, marginBottom: 12 },
  barRow: { marginBottom: 14 },
  barLabels: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  barNameContainer: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  barName: { fontWeight: '800', color: colors.text, fontSize: 14 },
  barPct: { fontSize: 11, fontWeight: '700', color: colors.textMuted, backgroundColor: colors.softGreenBg, paddingVertical: 1, paddingHorizontal: 6, borderRadius: 8 },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  categoryBadge: { backgroundColor: colors.softGreenBg, paddingVertical: 2, paddingHorizontal: 8, borderRadius: 10 },
  categoryBadgeText: { color: colors.softGreenText, fontSize: 11, fontWeight: '700' },
  barValue: { fontWeight: '800', color: colors.text, fontSize: 14 },
  barTrack: { height: 10, backgroundColor: colors.barTrack, borderRadius: 10, overflow: 'hidden' },
  barFill: { height: '100%', backgroundColor: colors.barFill, borderRadius: 10 },
  empty: { color: colors.textMuted, textAlign: 'center', paddingVertical: 25 },
  inline: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  smallButton: { backgroundColor: colors.primary, paddingVertical: 12, paddingHorizontal: 16, borderRadius: 12 },
  secondaryButton: { backgroundColor: colors.softGreenBg, padding: 13, borderRadius: 12, alignItems: 'center', borderWidth: 1, borderColor: colors.cardBorder },
  secondaryText: { color: colors.softGreenText, fontWeight: '900' },
  settingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.cardBorder },
  settingTitle: { fontWeight: '800', color: colors.text },
  settingHelp: { fontSize: 12, color: colors.textMuted, marginTop: 4, lineHeight: 17 },
  fabContainer: { position: 'absolute', bottom: 96, right: 18, gap: 12, zIndex: 999 },
  fabButton: { width: 56, height: 56, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.fabCamera, borderRadius: 28, elevation: 6, shadowColor: '#1A2521', shadowOffset: { width: 0, height: 3 }, shadowOpacity: .22, shadowRadius: 5 },
  fabGallery: { backgroundColor: colors.fabGallery, borderWidth: 1, borderColor: colors.cardBorder },
  cameraIcon: { width: 25, height: 18, borderWidth: 2, borderColor: 'white', borderRadius: 4, alignItems: 'center', justifyContent: 'center' },
  cameraTop: { position: 'absolute', top: -6, width: 11, height: 6, borderTopLeftRadius: 3, borderTopRightRadius: 3, backgroundColor: 'white' },
  cameraLens: { width: 8, height: 8, borderRadius: 4, borderWidth: 2, borderColor: 'white' },
  photoIcon: { width: 25, height: 21, borderWidth: 2, borderColor: colors.primary, borderRadius: 3, overflow: 'hidden' },
  photoSun: { position: 'absolute', width: 5, height: 5, borderRadius: 3, backgroundColor: colors.primary, right: 4, top: 4 },
  photoMountainLeft: { position: 'absolute', width: 17, height: 17, borderWidth: 2, borderColor: colors.primary, transform: [{ rotate: '45deg' }], left: -3, top: 12 },
  photoMountainRight: { position: 'absolute', width: 12, height: 12, borderWidth: 2, borderColor: colors.primary, transform: [{ rotate: '45deg' }], right: -2, top: 13 },
  addContainer: { gap: 12 },
  addHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  addTitle: { fontSize: 24, fontWeight: '900', color: colors.text },
  batchNote: { fontSize: 12, color: colors.textMuted, marginTop: 3 },
  skipButton: { paddingVertical: 9, paddingHorizontal: 11 },
  skipText: { fontSize: 13, color: colors.textMuted, fontWeight: '700' },
  formNotice: { color: colors.warningText, fontSize: 12, lineHeight: 18, marginBottom: 6 },
  inputAttention: { borderColor: colors.accent, borderWidth: 2, backgroundColor: colors.warningBg },
  imageCard: { flexDirection: 'row', backgroundColor: colors.cardBg, padding: 12, borderRadius: 18, alignItems: 'center', gap: 14, marginBottom: 10, borderWidth: 1, borderColor: colors.cardBorder },
  compactPreview: { width: 80, height: 100, borderRadius: 12, backgroundColor: colors.softGreenBg },
  imageCardInfo: { flex: 1, justifyContent: 'center' },
  imageCardTitle: { fontSize: 17, fontWeight: '800', color: colors.text },
  imageCardAmount: { fontSize: 22, fontWeight: '900', color: colors.primary, marginVertical: 4 },
  compactButton: { backgroundColor: colors.softGreenBg, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8, alignSelf: 'flex-start', marginTop: 4, borderWidth: 1, borderColor: colors.cardBorder },
  compactButtonText: { color: colors.softGreenText, fontSize: 12, fontWeight: '800' },
  confidenceBanner: { backgroundColor: colors.softGreenBg, padding: 10, borderRadius: 10, marginBottom: 12 },
  confidenceText: { color: colors.softGreenText, fontWeight: '800', fontSize: 13 },
  lowBanner: { backgroundColor: colors.warningBg },
  lowText: { color: colors.warningText },
  fieldRow: { flexDirection: 'row', gap: 10 },
  halfField: { flex: 1 },
  subLabel: { fontSize: 12, fontWeight: '700', color: colors.textMuted, marginBottom: 4 },
  inlineRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 8 },
  primaryDisabled: { opacity: .55 },
  disclosure: { marginTop: 12, paddingVertical: 11, paddingHorizontal: 12, borderRadius: 12, backgroundColor: colors.softGreenBg, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: colors.cardBorder },
  disclosureTitle: { fontSize: 13, fontWeight: '800', color: colors.softGreenText },
  disclosureSummary: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  disclosureArrow: { fontSize: 11, color: colors.primary, fontWeight: '900' },
  optionalPanel: { paddingTop: 12 },
  debugSection: { marginTop: 20, borderTopWidth: 1, borderTopColor: colors.cardBorder, paddingTop: 12 },
  debugHeader: { backgroundColor: colors.softGreenBg, padding: 10, borderRadius: 10, alignItems: 'center' },
  debugHeaderText: { color: colors.textMuted, fontWeight: '800', fontSize: 12 },
  debugContent: { backgroundColor: colors.cardBg, padding: 12, borderRadius: 10, marginTop: 8, borderWidth: 1, borderColor: colors.cardBorder },
  debugMeta: { fontSize: 12, fontWeight: '700', color: colors.textMuted, marginBottom: 4 },
  debugTextLabel: { fontSize: 12, fontWeight: '800', color: colors.text, marginTop: 6, marginBottom: 4 },
  debugScroll: { maxHeight: 140, backgroundColor: colors.bg, padding: 8, borderRadius: 8, borderWidth: 1, borderColor: colors.cardBorder },
  debugText: { fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', fontSize: 11, color: colors.text, lineHeight: 16 }
});
