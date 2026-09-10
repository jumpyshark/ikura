import { CameraView, useCameraPermissions } from 'expo-camera';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Image, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

export function BatchCamera({uris,onPhoto,onDone,onGallery,onRemove,limit=10}:{uris:string[];onPhoto:(uri:string)=>void;onDone:()=>void;onGallery:()=>void;onRemove:(index:number)=>void;limit?:number}) {
  const camera=useRef<CameraView>(null),locked=useRef(false),mounted=useRef(true);
  const [permission,requestPermission]=useCameraPermissions();
  const [ready,setReady]=useState(false),[shooting,setShooting]=useState(false),[torch,setTorch]=useState(false);
  const [foreground,setForeground]=useState(AppState.currentState==='active');
  const [failed,setFailed]=useState(false),[restart,setRestart]=useState(0);
  useEffect(()=>{mounted.current=true;const listener=AppState.addEventListener('change',state=>{setForeground(state==='active');setReady(false);});return ()=>{mounted.current=false;listener.remove();};},[]);
  useEffect(()=>{if(permission && !permission.granted && permission.canAskAgain) void requestPermission();},[permission?.status]);
  const shoot=async()=>{
    if(locked.current||!ready||uris.length>=limit)return;
    locked.current=true;setShooting(true);
    try {const image=await camera.current?.takePictureAsync({quality:1,skipProcessing:false});if(mounted.current && image)onPhoto(image.uri);}
    catch {if(mounted.current)Alert.alert('撮影できませんでした','端末を安定させて、もう一度撮影してください。');}
    finally {locked.current=false;if(mounted.current)setShooting(false);}
  };
  return <View style={s.root}>
    <Text style={s.help}>1枚につき1つのレシートを撮影してください。</Text>
    <View style={s.cameraBox}>
      {!permission?<ActivityIndicator/>:!permission.granted?<View style={s.message}><Text>撮影にはカメラの許可が必要です。</Text><Action label="カメラを許可" onPress={()=>void requestPermission()}/><Action label="端末の設定を開く" onPress={()=>void Linking.openSettings()}/></View>:failed?<View style={s.message}><Text>カメラを起動できませんでした。</Text><Action label="再試行" onPress={()=>{setFailed(false);setRestart(n=>n+1);}}/></View>:foreground?<CameraView key={restart} ref={camera} style={StyleSheet.absoluteFill} facing="back" mode="picture" enableTorch={torch} onCameraReady={()=>setReady(true)} onMountError={()=>{setReady(false);setFailed(true);}}/>:<Text style={s.help}>カメラは一時停止中です。</Text>}
    </View>
    <View style={s.controls}><Action label={torch?'ライトを消す':'ライトをつける'} disabled={!ready||shooting} onPress={()=>setTorch(!torch)}/><Pressable accessibilityRole="button" accessibilityLabel="写真を撮る" disabled={!ready||shooting||uris.length>=limit} onPress={()=>void shoot()} style={[s.shutter,(!ready||shooting||uris.length>=limit)&&{opacity:.4}]}>{shooting?<ActivityIndicator color="#0f766e"/>:<View style={s.shutterInner}/>}</Pressable><Text>{uris.length}／{limit}枚</Text></View>
    <ScrollView horizontal style={s.strip} contentContainerStyle={{gap:8}}>{uris.map((uri,i)=><Pressable key={uri+i} disabled={shooting} onPress={()=>Alert.alert(`${i+1}枚目を削除しますか？`,'他の画像は残ります。',[{text:'戻る',style:'cancel'},{text:'削除',style:'destructive',onPress:()=>onRemove(i)}])}><Image source={{uri}} style={s.thumb}/><Text style={s.caption}>{i+1}枚目</Text></Pressable>)}</ScrollView>
    <View style={s.footer}><Action label="画像を選択" disabled={shooting} onPress={onGallery}/><Action primary label={`完了（${uris.length}枚）`} disabled={shooting||!uris.length} onPress={onDone}/></View>
  </View>;
}
function Action({label,onPress,disabled=false,primary=false}:{label:string;onPress:()=>void;disabled?:boolean;primary?:boolean}){return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[s.button,primary&&{backgroundColor:'#0f766e'},disabled&&{opacity:.4}]}><Text style={{color:primary?'white':'#174a3c',fontWeight:'700'}}>{label}</Text></Pressable>;}
const s=StyleSheet.create({root:{flex:1,paddingHorizontal:16,paddingBottom:8,gap:8},help:{fontSize:13,color:'#52685f',paddingVertical:4},cameraBox:{flex:1,minHeight:80,overflow:'hidden',borderRadius:16,backgroundColor:'#172923',justifyContent:'center'},message:{padding:20,gap:12,backgroundColor:'#f4f7f5'},controls:{flexDirection:'row',justifyContent:'space-around',alignItems:'center',gap:8},shutter:{width:66,height:66,borderRadius:33,borderWidth:3,borderColor:'#0f766e',alignItems:'center',justifyContent:'center',backgroundColor:'white'},shutterInner:{width:52,height:52,borderRadius:26,backgroundColor:'#0f766e'},strip:{maxHeight:78,flexGrow:0},thumb:{width:52,height:54,borderRadius:6},caption:{fontSize:11,textAlign:'center'},footer:{flexDirection:'row',justifyContent:'space-between',gap:8},button:{padding:12,borderRadius:12,backgroundColor:'#dceae6',flexShrink:1}});
