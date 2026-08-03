Loose prose before the first heading. It belongs to the note itself, so the
root pill is where it is drawn.

# Structure

Body text on a heading, before any child of its own.

- plain item
  - nested item
    - deeper item
- [ ] open task
- [x] done task
- [X] done, uppercase

## Body text

Text before the first item. With the line at the end of this section, the
heading's own text comes in two runs, and each is edited on its own.

- item with a description
  The description is indented under the item, has no marker of its own, and
  moves and deletes with it.
- item with text before its child
  A list item cannot own text after one: the indent that would reach past the
  child belongs to the child.
  - child in the middle
- item with a nested block

      indented four spaces inside the description, and it has to come back out
      exactly as deep after an edit

  tail after the block
- https://github.com/vulture039/obsidian-mindmap-editor/blob/master/README.md is a long unbroken run and has to wrap inside the node

And the second run of this heading's text, after every item it has.

## Links

- a [[Linked]] wikilink to another note, to follow
- an [alias](https://obsidian.md) link

## Long text

- an item whose own label runs long enough to wrap onto a second line inside the node pill, which is where the width cap shows

## aa
aaaa
# Second section

Body text on a heading that has no child node at all.

```js
// a fenced block at the top level: no node comes out of these lines
const x = 1;
```

## Deep nesting

### Level three

#### Level four

- and a list under it
  - to check the colors keep coming from the top-level branch

## aaa