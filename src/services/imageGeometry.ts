export type Crop = { x:number; y:number; width:number; height:number };
export const fullCrop = ():Crop => ({x:0,y:0,width:1,height:1});
export function validCrop(c:Crop) {
  return Object.values(c).every(Number.isFinite) && c.x>=0 && c.y>=0 && c.width>=.05 && c.height>=.05 && c.x+c.width<=1.00001 && c.y+c.height<=1.00001;
}

/** Conservative bright-paper component proposal. Unknown backgrounds retain the whole image. */
export function suggestCrop(pixels:number[], width:number, height:number): {crop:Crop; suggested:boolean; warnings:string[]} {
  const unchanged = {crop:fullCrop(),suggested:false,warnings:['範囲を自動で特定できませんでした。必要に応じて調整してください。']};
  if(width<4 || height<4 || pixels.length!==width*height) return unchanged;
  const sorted=[...pixels].sort((a,b)=>a-b);
  const low=sorted[Math.floor(sorted.length*.1)]!, high=sorted[Math.floor(sorted.length*.9)]!;
  if(high-low<45) return unchanged;
  const threshold=Math.max(130,low+(high-low)*.60);
  const visited=new Uint8Array(pixels.length);
  const components:Array<{size:number;left:number;right:number;top:number;bottom:number}>=[];
  for(let i=0;i<pixels.length;i++) {
    if(visited[i] || pixels[i]!<threshold) continue;
    const queue=[i]; visited[i]=1;
    let left=width,right=0,top=height,bottom=0;
    for(let at=0;at<queue.length;at++) {
      const point=queue[at]!,x=point%width,y=Math.floor(point/width);
      left=Math.min(left,x); right=Math.max(right,x); top=Math.min(top,y); bottom=Math.max(bottom,y);
      for(const n of [x>0?point-1:-1,x<width-1?point+1:-1,y>0?point-width:-1,y<height-1?point+width:-1]) {
        if(n>=0 && !visited[n] && pixels[n]!>=threshold) {visited[n]=1;queue.push(n);}
      }
    }
    components.push({size:queue.length,left,right,top,bottom});
  }
  components.sort((a,b)=>b.size-a.size);
  const best=components[0]; if(!best) return unchanged;
  const area=(best.right-best.left+1)*(best.bottom-best.top+1);
  if(best.size/pixels.length<.15 || area/pixels.length>.94 || best.size/area<.65 || (components[1]?.size??0)>best.size*.35) return unchanged;
  // Padding preserves faint text along the edges. Never force a tight detected crop.
  const x=Math.max(0,best.left/width-.035),y=Math.max(0,best.top/height-.035);
  const crop={x,y,width:Math.min(1,(best.right+1)/width+.035)-x,height:Math.min(1,(best.bottom+1)/height+.035)-y};
  return {crop,suggested:true,warnings:['切り取り範囲は候補です。店名・日付・合計が収まっているか確認してください。']};
}

export function moveCorner(c:Crop, corner:number, x:number, y:number):Crop {
  const clamp=(n:number,min:number,max:number)=>Math.max(min,Math.min(max,n));
  const left=corner===0 || corner===3 ? clamp(x,0,c.x+c.width-.05) : c.x;
  const right=corner===1 || corner===2 ? clamp(x,c.x+.05,1) : c.x+c.width;
  const top=corner===0 || corner===1 ? clamp(y,0,c.y+c.height-.05) : c.y;
  const bottom=corner===2 || corner===3 ? clamp(y,c.y+.05,1) : c.y+c.height;
  return {x:left,y:top,width:right-left,height:bottom-top};
}
