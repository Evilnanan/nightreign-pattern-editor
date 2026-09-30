function nodeKey(node:Node):string|null {
  if(!(node instanceof Element)) return null;
  if(node.id) return `id:${node.id}`;
  for(const attribute of ["data-render-key","data-location","data-tower","data-scroll-key"]) {
    if(node.hasAttribute(attribute)) return `${attribute}:${node.getAttribute(attribute)}`;
  }
  const first=node.classList[0];
  if(!first) return null;
  const detail=first==="filter-choice" || first==="night-circle" ? node.classList[1] : "";
  return `class:${first}:${detail}`;
}

function patchNode(current:Node, next:Node) {
  if(current instanceof Element && next instanceof Element) {
    for(const attribute of Array.from(current.attributes)) {
      if(!next.hasAttribute(attribute.name)) current.removeAttribute(attribute.name);
    }
    for(const attribute of Array.from(next.attributes)) {
      if(current.getAttribute(attribute.name)!==attribute.value) current.setAttribute(attribute.name,attribute.value);
    }
    patchChildren(current,next);
  } else if(current.nodeValue!==next.nodeValue) current.nodeValue=next.nodeValue;
}

// Retain matching elements so focus, hover, image decoding, and animations survive updates.
export function patchChildren(current:Element, next:ParentNode, preserve?:(node:Node)=>boolean) {
  const unused=new Set(Array.from(current.childNodes));
  let cursor=current.firstChild;
  for(const desired of Array.from(next.childNodes)) {
    const key=nodeKey(desired);
    const existing=[...unused].find(node=>node.nodeType===desired.nodeType &&
      node.nodeName===desired.nodeName && nodeKey(node)===key);
    const child=existing ?? desired.cloneNode(true);
    if(existing) {unused.delete(existing);patchNode(existing,desired);}
    if(child!==cursor) current.insertBefore(child,cursor);
    cursor=child.nextSibling;
  }
  for(const node of unused) if(!preserve?.(node)) node.parentNode?.removeChild(node);
}
