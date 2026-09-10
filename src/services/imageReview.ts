import { requireNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';
import { fullCrop, suggestCrop, validCrop, type Crop } from './imageGeometry';
export type Filter = 'original'|'enhanced'|'mono';
export type ReviewPhoto = {
  id:string; originalUri:string; source:'receipt'|'screenshot'; rotation:number;
  baseUri?:string; width?:number; height?:number; crop:Crop; filter:Filter;
  previewUri?:string; approved:boolean; warnings:string[];
};
type Prepared = {uri:string;width:number;height:number;pixels:number[];thumbnailWidth:number;thumbnailHeight:number};
type NativeReview = {
  prepareReviewImage:(uri:string,rotation:number)=>Promise<Prepared>;
  renderReviewImage:(uri:string,crop:number[],filter:string)=>Promise<string>;
  removeReviewImages:(uris:string[])=>Promise<void>;
};
const native = () => {
  if(Platform.OS==='web') throw new Error('画像の確認機能はスマートフォン版で利用できます。');
  const module=requireNativeModule<NativeReview>('ExpoTextExtractor');
  if(typeof module.prepareReviewImage!=='function') throw new Error('画像の確認機能を利用するには、最新版のアプリをインストールしてください。');
  return module;
};
export function newPhoto(uri:string, source:ReviewPhoto['source']):ReviewPhoto {
  return {id:Date.now().toString()+Math.random().toString(36).slice(2),originalUri:uri,source,rotation:0,crop:fullCrop(),filter:source==='screenshot'?'original':'enhanced',approved:false,warnings:[]};
}
export async function preparePhoto(photo:ReviewPhoto, track:(uri:string)=>void):Promise<ReviewPhoto> {
  const image=await native().prepareReviewImage(photo.originalUri,photo.rotation); track(image.uri);
  const proposal=photo.source==='screenshot' ? {crop:fullCrop(),warnings:[]} : suggestCrop(image.pixels,image.thumbnailWidth,image.thumbnailHeight);
  return {...photo,baseUri:image.uri,width:image.width,height:image.height,crop:proposal.crop,warnings:proposal.warnings,approved:false,previewUri:undefined};
}
export async function renderPhoto(photo:ReviewPhoto, track:(uri:string)=>void):Promise<ReviewPhoto> {
  if(!photo.baseUri || !validCrop(photo.crop)) throw new Error('切り取り範囲を確認してください。');
  const c=photo.crop;
  const uri=await native().renderReviewImage(photo.baseUri,[c.x,c.y,c.width,c.height],photo.filter); track(uri);
  return {...photo,previewUri:uri};
}
export async function cleanupReview(uris:string[]) { if(uris.length) { try { await native().removeReviewImages(uris); } catch { /* Cache files can be reclaimed by the OS. */ } } }
