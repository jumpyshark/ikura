import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fullCrop,moveCorner,suggestCrop,validCrop} from '../src/services/imageGeometry';

test('bright paper proposal includes all boundaries and safety padding',()=>{
 const pixels=Array.from({length:10000},(_,i)=>{const x=i%100,y=Math.floor(i/100);return x>=25&&x<=75&&y>=10&&y<=90?230:35;});
 const {crop,suggested}=suggestCrop(pixels,100,100);
 assert.equal(suggested,true);assert.ok(crop.x<.25&&crop.y<.1);assert.ok(crop.x+crop.width>.76);assert.ok(crop.y+crop.height>.91);assert.ok(validCrop(crop));
});
test('uncertain white background preserves full image',()=>{
 assert.deepEqual(suggestCrop(Array(10000).fill(230),100,100).crop,fullCrop());
});
test('two similar receipts do not trigger one destructive crop',()=>{
 const pixels=Array.from({length:10000},(_,i)=>{const x=i%100,y=Math.floor(i/100);return y>10&&y<90&&((x>5&&x<40)||(x>60&&x<95))?230:20;});
 assert.equal(suggestCrop(pixels,100,100).suggested,false);
});
test('dragging corners cannot invert rectangle or leave image',()=>{
 for(let corner=0;corner<4;corner++)for(const x of [-10,0,.5,1,10])for(const y of [-10,0,.5,1,10])assert.ok(validCrop(moveCorner(fullCrop(),corner,x,y)));
});
test('reject invalid and empty crop coordinates',()=>{
 assert.equal(validCrop({x:NaN,y:0,width:1,height:1}),false);
 assert.equal(validCrop({x:0,y:0,width:0,height:1}),false);
 assert.equal(validCrop({x:.5,y:0,width:1,height:1}),false);
});
