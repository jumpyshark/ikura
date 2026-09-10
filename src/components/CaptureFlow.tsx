import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Modal, PanResponder, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { cleanupReview, newPhoto, preparePhoto, renderPhoto, type Filter, type ReviewPhoto } from '../services/imageReview';
import { fitImage, fullCrop, moveCorner, type Crop } from '../services/imageGeometry';
import { extractExpense } from '../services/ocr';
import type { PaymentCandidate } from '../services/payments';
import { applyAiFallback } from '../services/aiFallback';
import { BatchCamera } from './BatchCamera';

export type ReviewedCandidate = PaymentCandidate & { imageUri:string };
const LIMIT=10;
export function CaptureFlow({visible,onClose,onDiscard,onComplete,aiEnabled,onDirty,entry,focusUri}:{visible:boolean;onClose:()=>void;onDiscard:()=>void;onComplete:(rows:ReviewedCandidate[],signature:string)=>void;aiEnabled:boolean;onDirty:(dirty:boolean)=>void;entry:'camera'|'gallery'|'review';focusUri?:string}) {
  const [photos,setPhotos]=useState<ReviewPhoto[]>([]);
  const [stage,setStage]=useState<'capture'|'review'|'processing'>('capture');
  const [index,setIndex]=useState(0);
  const [working,setWorking]=useState(false);
  const [editingCrop,setEditingCrop]=useState(false);
  const [original,setOriginal]=useState(false);
  const [progress,setProgress]=useState('');
  const [retakeId,setRetakeId]=useState<string>();
  const lock=useRef(false),generation=useRef(0),alive=useRef(true);
  const generated=useRef<string[]>([]);
  const results=useRef(new Map<string,ReviewedCandidate[]>());
  const attempted=useRef(new Set<string>());
  const photo=photos[index];
  useEffect(()=>onDirty(photos.length>0),[photos.length,onDirty]);
  useEffect(()=>{alive.current=true;return ()=>{alive.current=false; generation.current++; void cleanupReview(generated.current);};},[]);
  const track=(uri:string)=>{ if(alive.current) generated.current.push(uri); else void cleanupReview([uri]); };
  const update=(next:ReviewPhoto)=>setPhotos(previous=>previous.map(p=>p.id===next.id?next:p));
  const work=async (job:(token:number)=>Promise<void>)=>{
    if(lock.current) return;
    lock.current=true; setWorking(true); const token=++generation.current;
    try {await job(token);} catch(error) {if(alive.current && token===generation.current) Alert.alert('処理できませんでした',error instanceof Error && error.message.includes('最新版のアプリ') ? '画像の確認機能を利用するには、最新版のアプリをインストールしてください。' : '画像は残っています。もう一度お試しいただくか、画像を変更してください。');}
    finally {if(alive.current && token===generation.current) {lock.current=false;setWorking(false);}}
  };
  const active=(token:number)=>alive.current && token===generation.current;
  const cancelWork=()=>{generation.current++;lock.current=false;setWorking(false);setStage(photos.length?'review':'capture');setProgress('');};
  const discard=()=>Alert.alert('未保存の内容を破棄しますか？','画像・切り取り設定・未保存の入力内容が消えます。保存済みの支出は削除されません。',[
    {text:'戻る',style:'cancel'}, {text:'破棄する',style:'destructive',onPress:onDiscard}
  ]);
  const pick=(source:ReviewPhoto['source']='screenshot')=>void work(async token=>{
    if(photos.length>=LIMIT) {Alert.alert('画像は10枚までです','先に現在の画像を確認してください。');return;}
    const options:ImagePicker.ImagePickerOptions={mediaTypes:['images'],quality:1,allowsEditing:false};
    const picked=await ImagePicker.launchImageLibraryAsync({...options,allowsMultipleSelection:true,selectionLimit:LIMIT-photos.length,orderedSelection:true});
    if(!active(token)||picked.canceled) return;
    const added=picked.assets.slice(0,LIMIT-photos.length).map(a=>newPhoto(a.uri,source));
    if(!added.length) return;
    setPhotos(old=>[...old,...added]);
  });
  useEffect(()=>{
    if(!visible)return;
    setEditingCrop(false);setOriginal(false);setRetakeId(undefined);
    if(entry==='review' && photos.length) {setStage('review');setIndex(Math.max(0,photos.findIndex(p=>p.previewUri===focusUri)));}
    else {setStage('capture');if(entry==='gallery')pick('screenshot');}
  },[visible]);
  const addPhoto=(uri:string)=>{
    const next=newPhoto(uri,'receipt');
    if(retakeId){setPhotos(old=>old.map(p=>p.id===retakeId?next:p));setRetakeId(undefined);setStage('review');}
    else setPhotos(old=>old.length<LIMIT?[...old,next]:old);
  };
  const prepareCurrent=()=>void work(async token=>{
    if(!photo) return;
    const base=await preparePhoto(photo,track);
    if(!active(token)) return;
    const rendered=await renderPhoto(base,track);
    if(active(token)) update(rendered);
  });
  useEffect(()=>{if(visible && stage==='review' && photo && !photo.baseUri && !working && !attempted.current.has(photo.id)) {attempted.current.add(photo.id);prepareCurrent();}},[visible,stage,photo?.id,working]);
  const render=(next:ReviewPhoto)=>void work(async token=>{
    const rendered=await renderPhoto({...next,approved:false},track);
    if(active(token)) {update(rendered);setEditingCrop(false);setOriginal(false);}
  });
  const rotate=()=>void work(async token=>{
    if(!photo) return;
    const next=await preparePhoto({...photo,rotation:(photo.rotation+1)%4},track);
    if(!active(token)) return;
    const rendered=await renderPhoto(next,track);
    if(active(token)) {update(rendered);setEditingCrop(false);}
  });
  const read=()=>void work(async token=>{
    if(!photos.length) return;
    setStage('processing');
    const all:ReviewedCandidate[]=[];
    for(let i=0;i<photos.length;i++) {
      if(!active(token)) return;
      let p=photos[i]!;
      setProgress(`画像を補正・読み取り中：${i+1}／${photos.length}枚`);
      try {
        if(!p.baseUri) {p=await preparePhoto(p,track);if(!active(token))return;update(p);}
        if(!p.previewUri) {p=await renderPhoto(p,track);if(!active(token))return;update(p);}
      } catch {
        if(active(token)){setIndex(i);setStage('review');Alert.alert('画像を補正できませんでした',`${i+1}枚目を撮り直すか、削除してください。他の画像は残っています。`);}
        return;
      }
      const uri=p.previewUri!;
      let rows=results.current.get(uri);
      if(!rows) {
        try {
          rows=(await extractExpense(uri)).map(row=>({...row,imageUri:uri}));
          if(aiEnabled) for(const row of rows) {
            if(!active(token))return;
            if(row.kind==='expense') {try {row.draft=await applyAiFallback(row.draft);} catch {row.draft.warnings=[...(row.draft.warnings??[]),'AI補助を利用できませんでした。読み取り結果を確認してください。'];}}
          }
        }
        catch {
          if(!active(token))return;
          rows=[{kind:'unknown',imageUri:uri,draft:{storeName:'',date:'',amount:'',category:'その他',paymentMethod:'未設定',note:'',sourceType:p.source==='screenshot'?'payment_screenshot':'receipt',confidence:0,rawText:'',warnings:['文字を読み取れませんでした。画像を見ながら入力するか、画像を調整してください。']}}];
        }
        if(!active(token)) return;
        results.current.set(uri,rows);
      }
      all.push(...rows);
    }
    if(active(token)) {setStage('review');onComplete(all,all.map(row=>row.imageUri).join('|'));}
  });
  return <Modal visible={visible} presentationStyle="fullScreen" animationType="slide" onRequestClose={()=>working?cancelWork():onClose()}><SafeAreaProvider style={{flex:1}}><SafeAreaView style={s.safe} edges={['top','bottom','left','right']}>
    <View style={s.header}><Text style={s.title}>{stage==='capture'?'レシートを撮影':stage==='review'?`画像確認：${index+1}／${photos.length}枚`:'文字を読み取り'}</Text><Button label="戻る" disabled={working} onPress={onClose}/></View>
    <Text style={s.steps}>撮影 → 自動補正・読み取り → 画像と内容を確認 → 保存</Text>
    {stage==='capture'?<>{working?<View style={s.center}><ActivityIndicator/></View>:visible?<BatchCamera key={retakeId??'batch'} uris={retakeId?[]:photos.map(p=>p.originalUri)} limit={retakeId?1:LIMIT} onPhoto={addPhoto} onDone={read} onRemove={i=>setPhotos(old=>old.filter((_,at)=>at!==i))} onGallery={()=>Alert.alert('画像の種類','読み込む画像を選んでください。',[{text:'戻る',style:'cancel'},{text:'紙レシート',onPress:()=>pick('receipt')},{text:'決済画面',onPress:()=>pick('screenshot')}])}/>:null}</>:stage==='processing'?<View style={s.center}><ActivityIndicator size="large"/><Text>{progress}</Text><Text style={s.help}>画像を1枚ずつ処理しています。</Text><Button label="読み取りを中止して画像確認に戻る" onPress={cancelWork}/></View>:editingCrop&&photo?<View style={s.page}>
      <CropEditor photo={photo} onChange={crop=>update({...photo,crop,approved:false,previewUri:undefined})}/>
      <Button primary label="この範囲を適用" disabled={working} onPress={()=>render(photo)}/>
      <Button label="全体に戻す" disabled={working} onPress={()=>render({...photo,crop:fullCrop()})}/>
      {working&&<ActivityIndicator/>}
    </View>:<ScrollView contentContainerStyle={s.page}>
      {photo?<>
        <Text style={s.help}>店名・日付・合計が切れていないか確認してください。ぼやけや反射がある場合は撮り直してください。</Text>
        {photo.warnings.map(w=><Text key={w} style={s.warning}>{w}</Text>)}
        {photo.baseUri && photo.width && photo.height ? editingCrop ? <CropEditor key={photo.id+photo.rotation} photo={photo} onChange={crop=>update({...photo,crop,approved:false,previewUri:undefined})}/> : <Image source={{uri:original?photo.baseUri:photo.previewUri??photo.baseUri}} style={s.preview} resizeMode="contain"/> : <Image source={{uri:photo.originalUri}} style={s.preview} resizeMode="contain"/>}
        {working&&<ActivityIndicator/>}
        {!photo.baseUri && !working && <Button label="画像の準備を再試行" onPress={prepareCurrent}/>}
        {photo.baseUri && <>
          <View style={s.row}><Button label={original?'補正後を表示':'元画像と比較'} disabled={working||editingCrop} onPress={()=>setOriginal(!original)}/><Button label="右に90度回転" disabled={working} onPress={rotate}/></View>
          <Text style={s.help}>範囲は長方形で調整できます。斜めの写真は、正面から撮り直すと読み取りやすくなります。</Text>
          <Button label={editingCrop||!photo.previewUri?'この範囲を適用':'切り取り範囲を調整'} disabled={working} onPress={()=>editingCrop||!photo.previewUri?render(photo):setEditingCrop(true)}/>
          <Button label="全体に戻す" disabled={working} onPress={()=>render({...photo,crop:fullCrop()})}/>
          <Text style={s.title}>画像の補正</Text><View style={s.row}>{([['original','元の色'],['enhanced','くっきり'],['mono','白黒']] as [Filter,string][]).map(([filter,label])=><Button key={filter} label={(photo.filter===filter?'✓ ':'')+label} disabled={working||editingCrop} onPress={()=>render({...photo,filter})}/>)}</View>
        </>}
        <View style={s.row}><Button label="撮り直す" disabled={working} onPress={()=>{setRetakeId(photo.id);setStage('capture');setEditingCrop(false);}}/><Button label="削除" disabled={working} onPress={()=>Alert.alert('この画像を削除しますか？','他の画像は残ります。',[{text:'戻る',style:'cancel'},{text:'削除',style:'destructive',onPress:()=>{setPhotos(old=>old.filter(p=>p.id!==photo.id));setIndex(Math.max(0,index-1));setEditingCrop(false);if(photos.length===1)setStage('capture');}}])}/></View>
        <View style={s.row}><Button label="前の画像" disabled={working||index===0} onPress={()=>{setIndex(index-1);setEditingCrop(false);setOriginal(false);}}/><Button label="次の画像" disabled={working||index===photos.length-1} onPress={()=>{setIndex(index+1);setEditingCrop(false);setOriginal(false);}}/></View>
        <Button primary label="画像と読み取り結果を確認する" disabled={working||editingCrop} onPress={read}/>
        <Button label="撮影・画像の追加に戻る" disabled={working} onPress={()=>setStage('capture')}/>
      </>:null}
      <Text style={s.help}>戻っても、この操作中は画像を保持します。アプリを終了すると未保存の作業は失われます。</Text>
      <Button label="未保存の画像をすべて破棄" disabled={working} onPress={discard}/>
    </ScrollView>}
  </SafeAreaView></SafeAreaProvider></Modal>;
}

function CropEditor({photo,onChange}:{photo:ReviewPhoto;onChange:(crop:Crop)=>void}) {
  const [availableWidth,setWidth]=useState(0);
  const screen=useWindowDimensions();
  const {width,height}=fitImage(photo.width!,photo.height!,Math.max(0,availableWidth-44),Math.min(380,screen.height*.4));
  const c=photo.crop;
  return <View onLayout={event=>setWidth(event.nativeEvent.layout.width)} style={{width:'100%',paddingVertical:22,alignItems:'center'}}>{width>0&&<View style={{width,height}}>
    <Image key={`${photo.baseUri}-${Math.round(width)}`} source={{uri:photo.baseUri}} style={{width,height}} resizeMode="contain" resizeMethod="resize"/>
    <View pointerEvents="none" style={{position:'absolute',left:c.x*width,top:c.y*height,width:c.width*width,height:c.height*height,borderWidth:2,borderColor:'#ef6b36'}}/>
    {[[c.x,c.y],[c.x+c.width,c.y],[c.x+c.width,c.y+c.height],[c.x,c.y+c.height]].map(([x,y],i)=><Corner key={i} x={x!} y={y!} width={width} height={height} label={['左上','右上','右下','左下'][i]!} move={(nx,ny)=>onChange(moveCorner(c,i,nx,ny))}/>)}
  </View>}<Text style={[s.help,{marginTop:24}]}>丸い印を動かして範囲を調整してください。</Text></View>;
}
function Corner({x,y,width,height,label,move}:{x:number;y:number;width:number;height:number;label:string;move:(x:number,y:number)=>void}) {
  const latest=useRef({x,y,width,height,move});latest.current={x,y,width,height,move};
  const start=useRef({x,y});
  const pan=useRef(PanResponder.create({onStartShouldSetPanResponder:()=>true,onMoveShouldSetPanResponder:()=>true,onPanResponderGrant:()=>{start.current={x:latest.current.x,y:latest.current.y};},onPanResponderMove:(_,g)=>latest.current.move(start.current.x+g.dx/latest.current.width,start.current.y+g.dy/latest.current.height)})).current;
  return <View accessibilityLabel={`${label}の切り取り位置`} {...pan.panHandlers} style={{position:'absolute',left:x*width-20,top:y*height-20,width:40,height:40,alignItems:'center',justifyContent:'center'}}><View style={{width:20,height:20,borderRadius:10,backgroundColor:'#ef6b36',borderWidth:2,borderColor:'white'}}/></View>;
}
function Button({label,onPress,disabled=false,primary=false}:{label:string;onPress:()=>void;disabled?:boolean;primary?:boolean}) {
  return <Pressable accessibilityRole="button" accessibilityState={{disabled}} disabled={disabled} onPress={onPress} style={[s.button,primary&&s.primary,disabled&&{opacity:.4}]}><Text style={[s.buttonText,primary&&{color:'white'}]}>{label}</Text></Pressable>;
}
const s=StyleSheet.create({safe:{flex:1,backgroundColor:'#f4f7f5'},header:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingHorizontal:16},title:{fontSize:18,fontWeight:'800',color:'#153e36',marginVertical:10},steps:{color:'#47665d',paddingHorizontal:16,paddingBottom:12},page:{padding:20,gap:10},help:{fontSize:14,color:'#50665e',lineHeight:22},button:{padding:12,borderRadius:12,backgroundColor:'#dceae6',marginVertical:3},buttonText:{textAlign:'center',color:'#0f665e',fontWeight:'700'},primary:{backgroundColor:'#0f766e'},thumbs:{flexDirection:'row',flexWrap:'wrap',gap:14},thumb:{width:90,height:115,borderRadius:8},preview:{width:'100%',height:380,backgroundColor:'#e2e9e6'},row:{flexDirection:'row',flexWrap:'wrap',gap:8},warning:{backgroundColor:'#fff0df',color:'#85512b',padding:12,borderRadius:10},center:{flex:1,alignItems:'center',justifyContent:'center',gap:20}});
