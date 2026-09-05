export function findFirstAnchor(target, isAttached) {
    if (!target)
        return null;
    switch (target.kind) {
        case 'host':
            if (target._shared)
                return null;
            return !isAttached || isAttached(target._node) ? target._node : null;
        case 'text':
            return !isAttached || isAttached(target._node) ? target._node : null;
        case 'frame':
            return !isAttached || isAttached(target._frame.start) ? target._frame.start : null;
        case 'component':
            return findFirstAnchor(target._content, isAttached);
        case 'fragment': {
            let children = target._children;
            for (let i = 0; i < children.length; i++) {
                let found = findFirstAnchor(children[i], isAttached);
                if (found)
                    return found;
            }
            return null;
        }
        case 'empty':
            return null;
    }
}
export function findLastAnchor(target, isAttached) {
    if (!target)
        return null;
    switch (target.kind) {
        case 'host':
            if (target._shared)
                return null;
            return !isAttached || isAttached(target._node) ? target._node : null;
        case 'text':
            return !isAttached || isAttached(target._node) ? target._node : null;
        case 'frame':
            return !isAttached || isAttached(target._frame.end) ? target._frame.end : null;
        case 'component':
            return findLastAnchor(target._content, isAttached);
        case 'fragment': {
            let children = target._children;
            for (let i = children.length - 1; i >= 0; i--) {
                let found = findLastAnchor(children[i], isAttached);
                if (found)
                    return found;
            }
            return null;
        }
        case 'empty':
            return null;
    }
}
export function findNextSiblingAnchor(target, resolveRootEnd, isAttached) {
    let parent = target._parent;
    if (parent.kind === 'component')
        return findNextSiblingAnchor(parent, resolveRootEnd, isAttached);
    let children = parent._children;
    let index = children.indexOf(target);
    if (index === -1)
        return null;
    for (let i = index + 1; i < children.length; i++) {
        let found = findFirstAnchor(children[i], isAttached);
        if (found)
            return found;
    }
    if (parent.kind === 'fragment')
        return findNextSiblingAnchor(parent, resolveRootEnd, isAttached);
    if (parent.kind === 'root' && resolveRootEnd)
        return resolveRootEnd(parent);
    return null;
}
export function findContextValue(parent, type) {
    let current = parent;
    while (current) {
        if (current.kind === 'component' && current.type === type) {
            return current._handle.getContextValue();
        }
        current = current.kind === 'root' ? undefined : current._parent;
    }
    return undefined;
}
export function hasScheduledAncestor(target, batch) {
    let current = target._parent;
    while (current) {
        if (current.kind === 'component' && batch.has(current))
            return true;
        current = current.kind === 'root' ? undefined : current._parent;
    }
    return false;
}
//# sourceMappingURL=vnode.js.map