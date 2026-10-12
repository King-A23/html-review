/* A child-frame locator checks child geometry. Also wait for the parent frame's
   compositor geometry after a toolbar/status reflow; do not retry the click. */
export async function waitPreviewLayout(page) {
  await page.locator('#preview-frame').evaluate(node=>new Promise((resolve,reject)=>{
    let previous='',stable=0;const deadline=performance.now()+5000;
    function check(){
      if(!node.isConnected)return reject(new Error('Preview was replaced while awaiting layout.'));
      const rect=node.getBoundingClientRect(),current=[rect.x,rect.y,rect.width,rect.height].join(',');
      const moving=document.querySelector('#workflow-details')?.getAnimations().some(animation=>animation.playState==='running');
      stable=current===previous && !moving ? stable+1 : 0;previous=current;
      if(stable>=2)return resolve();
      if(performance.now()>deadline)return reject(new Error('Preview layout did not settle.'));
      requestAnimationFrame(check);
    }
    requestAnimationFrame(check);
  }));
}
