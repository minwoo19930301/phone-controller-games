// 코스와 공 위치를 바꿔 가며 한 홀을 끝까지 플레이하는 화면.
import * as THREE from 'three';
import { makeGolfer } from './golfer.js';
import { CLUBS as BAG } from './clubs.js';
export const CLUBS = Object.fromEntries(BAG.map(c => [c.id.toLowerCase(), {...c, len:c.lengthM}]));
const RD=Math.PI/180;
const V=(x=0,y=0,z=0)=>new THREE.Vector3(x,y,z);
export function createScene(canvas, firstHole, firstCourse, difficulty='normal') {
  const renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'});
  renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.3));
  renderer.toneMapping=THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled=true;
  const scene=new THREE.Scene(), camera=new THREE.PerspectiveCamera(42,1,.05,6500);
  let hole,course,courseView,tee,ballAt=V(),target=V(0,0,1),aim=0,trail=null,markGroup=new THREE.Group();
  scene.add(markGroup);
  const sphere=new THREE.Mesh(new THREE.SphereGeometry(.043,20,12),new THREE.MeshStandardMaterial({color:0xffffff,roughness:.35}));
  sphere.castShadow=true;scene.add(sphere);
  const line=new THREE.Line(new THREE.BufferGeometry(),new THREE.LineDashedMaterial({color:0xffffff,dashSize:1,gapSize:.8,transparent:true,opacity:.8}));scene.add(line);
  let golfer=null,color='#ff5a5f',club='7i',shaft=V(.06,-.78,.62).normalize(),face=V(1,0,0),align=new THREE.Quaternion();
  const focus=V(),cam=V(),look=V();let previous=performance.now(),lastMode='';
  function resize(){const w=innerWidth,h=innerHeight;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix()}
  addEventListener('resize',resize);resize();
  function setHole(h,c,d='normal'){
    if(courseView)courseView.dispose();
    hole=h;course=c;courseView=h.build(scene,{level:'low',renderer,environment:false});
    renderer.toneMappingExposure=courseView.exposure;tee=courseView.setTee(d);setBall(tee.x,tee.z);
    setTrail(null);setMarkers([]);courseView.update(0,camera);
  }
  function setBall(x,z){ballAt.set(x,hole.height(x,z)+.0214,z);sphere.position.copy(ballAt);setAim(aim);}
  function setGolfer(c,id){
    if(golfer)golfer.dispose();color=c||color;club=id||club;
    golfer=makeGolfer({color});golfer.setClub(club.toUpperCase());scene.add(golfer.root);placeGolfer();
  }
  function placeGolfer(){if(golfer)golfer.placeAtBall(ballAt,target,hole.height(ballAt.x,ballAt.z));}
  function setAim(deg=0,dist){
    aim=deg;const p=hole.aimFrom(ballAt.x,ballAt.z),dx=p.x-ballAt.x,dz=p.z-ballAt.z;
    const theta=Math.atan2(dx,dz)-deg*RD;target.set(Math.sin(theta),0,Math.cos(theta));
    const len=Math.min(dist||Math.hypot(dx,dz),100),pts=[];
    for(let i=0;i<=50;i++){const x=ballAt.x+target.x*len*i/50,z=ballAt.z+target.z*len*i/50;pts.push(x,hole.height(x,z)+.12,z)}
    line.geometry.dispose();line.geometry=new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(pts,3));line.computeLineDistances();placeGolfer();
  }
  function setTrail(pts,c){if(trail){scene.remove(trail);trail.geometry.dispose();trail.material.dispose();trail=null}if(!pts)return;
    trail=new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts.filter((_,i)=>i%3===0).map(p=>V(...p))),new THREE.LineBasicMaterial({color:c||'#fff'}));scene.add(trail)}
  function setMarkers(items){markGroup.clear();for(const m of items){const mesh=new THREE.Mesh(new THREE.CylinderGeometry(.3,.3,.04,16),new THREE.MeshBasicMaterial({color:m.color}));mesh.position.set(m.x,hole.height(m.x,m.z)+.04,m.z);markGroup.add(mesh)}}
  function address(s){const basis=V(s[2],s[1],s[0]).normalize();align.setFromUnitVectors(basis,golfer.addressFor(club.toUpperCase()).shaft);golfer.resetSwing();}
  function pose(s,f){shaft.set(s[2],s[1],s[0]).normalize().applyQuaternion(align);face.set(f[2],f[1],f[0]).normalize().applyQuaternion(align);golfer.poseFromClub(shaft,undefined,{local:true,face})}
  function resetSwing(){if(golfer)golfer.pose('address')}
  function frame(now,v){const dt=Math.min(.05,(now-previous)/1000);previous=now;
    if(golfer){if(v.waggle)golfer.pose('waggle');golfer.update(dt)}
    if(v.ball)sphere.position.set(...v.ball);else sphere.position.copy(ballAt);
    line.visible=v.mode==='aim';if(courseView)courseView.update(dt,camera);
    const b=sphere.position,at=ballAt,behind=V(-target.x,0,-target.z),side=V(-target.z,0,target.x);
    let dest,poi;
    if(v.mode==='flight'||v.mode==='land'){const d=Math.max(10,Math.min(36,b.distanceTo(at)*.28));dest=b.clone().addScaledVector(behind,d).add(V(0,Math.max(5,d*.4),0));poi=b.clone();}
    // Face the golfer from the ball side, at a slight down-the-line angle.
    // The previous opposite side looked into the golfer's back and hid the
    // hands, club and address posture throughout the swing.
    else if(v.mode==='swing'){dest=at.clone().addScaledVector(side,3.8).addScaledVector(behind,1.2).add(V(0,1.75,0));poi=at.clone().addScaledVector(side,-.2).add(V(0,.9,0));}
    else if(v.mode==='green'){dest=V(hole.pin.x+15,hole.pinHeight()+20,hole.pin.z-25);poi=V(hole.pin.x,hole.pinHeight(),hole.pin.z)}
    else {dest=at.clone().addScaledVector(behind,8).addScaledVector(side,-1.5).add(V(0,3.4,0));poi=at.clone().addScaledVector(target,Math.min(90,hole.distToPin(at.x,at.z))).add(V(0,1,0));}
    dest.y=Math.max(dest.y,hole.height(dest.x,dest.z)+1.2);
    // Aim looks far down the fairway; carrying that target into the close-up
    // puts the golfer outside the frame on slower phones. Cut to the address
    // view when starting the swing, then continue smoothing within each view.
    if(v.cut||!cam.lengthSq()||(v.mode==='swing'&&lastMode!=='swing')){cam.copy(dest);look.copy(poi)}else{cam.lerp(dest,1-Math.exp(-dt*4));look.lerp(poi,1-Math.exp(-dt*4))}
    lastMode=v.mode;
    camera.position.copy(cam);camera.lookAt(look);camera.updateProjectionMatrix();renderer.render(scene,camera);
  }
  function project(x,y,z){const p=V(x,y,z).project(camera);return{x:(p.x*.5+.5)*innerWidth,y:(-p.y*.5+.5)*innerHeight,on:p.z<1}}
  setHole(firstHole,firstCourse,difficulty);setGolfer(color,club);
  return {frame,setHole,setBall,setGolfer,address,pose,resetSwing,setAim,setTrail,setMarkers,project,getPhi:()=>golfer?.swingU ?? 0};
}
