/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

import * as React from 'react';

import {ImageNodeDecorator} from './ImageNodeCore';

// The class lives in ImageNodeCore.ts so headless graphs can load it without
// React; this module attaches the editor's decorator.
const ImageComponent = React.lazy(() => import('./ImageComponent'));

ImageNodeDecorator.set((node) => (
  <ImageComponent
    src={node.__src}
    altText={node.__altText}
    width={node.__width}
    height={node.__height}
    maxWidth={node.__maxWidth}
    nodeKey={node.getKey()}
    showCaption={node.__showCaption}
    caption={node.__caption}
    captionsEnabled={node.__captionsEnabled}
    resizable={true}
  />
));

export * from './ImageNodeCore';
