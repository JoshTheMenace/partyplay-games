// Every visible Item keyed by id. Meshes rebuild only when an item's look changes; moves between owners blend smoothly.
import { Color, Group, Mesh, MeshStandardMaterial, Quaternion, Vector3 } from 'three';
import { matchRecipe, type Item } from '../model';
import type { Kit } from './kit';
import { itemLook, plateOffsets, popWobble, soupOf } from './layout';

const SOUP = { tomato: '#d9412f', onion: '#dcaa4f', mixed: '#e0763a' } as const;
/** Who shows an item: a tile index (>= 0), LOOSE, or a chef as `chefOwner(index)`. Numbers keep the frame loop allocation-free. */
export const LOOSE = -1, chefOwner = (index: number) => -2 - index;
type View = { group: Group; item: Item | null; look: string; owner: number; seen: boolean; from: Vector3; fromQ: Quaternion; blend: number; duration: number; pop: number; liquidMaterial?: MeshStandardMaterial };

export class ItemViews {
  readonly group = new Group();
  private views = new Map<number, View>();
  private pool: Group[] = [];
  constructor(private kit: Kit, private own: <T extends { dispose(): void }>(r: T) => T) {}

  begin() { for (const view of this.views.values()) view.seen = false; }
  /**
   * Show `item` at a world pose owned by `owner` (see LOOSE). A new owner starts a short blend from
   * where the item was and a squash-and-stretch pop (not for conveyor moves or flight); `slide` stretches the blend.
   */
  place(item: Item, owner: number, position: Vector3, rotation: Quaternion, scale: number, dt: number, slide = 0) {
    let view = this.views.get(item.id);
    if (!view) {
      view = { group: this.pool.pop() ?? new Group(), item: null, look: '', owner, seen: true, from: position.clone(), fromQ: rotation.clone(), blend: 1, duration: .1, pop: 0 };
      this.group.add(view.group); this.views.set(item.id, view);
    }
    view.seen = true;
    // Snapshots replace item objects only ~20 times a second, so the look string is not rebuilt every frame.
    if (item !== view.item) { view.item = item; const look = itemLook(item); if (look !== view.look) { view.look = look; this.build(view, item); } }
    if (owner !== view.owner) {
      view.from.copy(view.group.position); view.fromQ.copy(view.group.quaternion); view.blend = 0; view.owner = owner;
      view.duration = slide || (owner === LOOSE ? .05 : .12);
      if (!slide && owner !== LOOSE) view.pop = 0;
    }
    view.blend = Math.min(1, view.blend + dt / view.duration);
    const k = slide ? view.blend : 1 - (1 - view.blend) ** 3;
    view.group.position.lerpVectors(view.from, position, k);
    view.group.quaternion.slerpQuaternions(view.fromQ, rotation, k);
    const wobble = popWobble(view.pop += dt);
    view.group.scale.set(scale * (1 - wobble * .5), scale * (1 + wobble), scale * (1 - wobble * .5));
    return view.group;
  }
  end() {
    for (const [id, view] of this.views) if (!view.seen) { this.views.delete(id); view.group.clear(); view.group.removeFromParent(); this.pool.push(view.group); }
  }
  /** Replay the pop (a chop hit, a pot finishing). */
  bump(id: number) { const view = this.views.get(id); if (view) view.pop = 0; }
  /** Who showed this item last frame, used to detect conveyor moves. */
  ownerOf(id: number) { return this.views.get(id)?.owner ?? LOOSE; }

  private build(view: View, item: Item) {
    const { kit } = this, g = view.group;
    g.clear();
    const add = (names: string[], x = 0, y = 0, z = 0, scale = 1, yaw = 0) => { const mesh = kit.spawn(kit.template(...names)); mesh.position.set(x, y, z); mesh.scale.setScalar(scale); mesh.rotation.y = yaw; g.add(mesh); return mesh; };
    const food = (part: Item['parts'][number]) => part.state === 'burnt' ? [`${part.food}_burnt`, 'burnt'] : [`${part.food}_${part.state}`, `${part.food}_raw`];
    switch (item.kind) {
      case 'food': add(food(item.parts[0])); break;
      case 'plate': {
        add(['plate']);
        const recipe = matchRecipe(item);
        if (recipe) add([`dish_${recipe}`], 0, .03);
        else plateOffsets(item.parts.length).forEach(([x, z], i) => add(food(item.parts[i]), x, .03 + i * .012, z, item.parts.length > 1 ? .72 : .9, i * 1.7));
        break;
      }
      case 'dirty': for (let i = 0; i < Math.min(6, item.count ?? 1); i++) add(['plate_dirty'], 0, i * .04, 0, 1, i * 1.3); break;
      case 'pot': {
        add(['pot']);
        if (!item.parts.length) break;
        const soup = soupOf(item);
        view.liquidMaterial ??= this.own(new MeshStandardMaterial({ roughness: .25 }));
        view.liquidMaterial.color.set(soup.burnt ? '#2b1d17' : SOUP[soup.kind]);
        if (!item.parts.some(part => part.state !== 'chopped')) view.liquidMaterial.color.lerp(new Color('#f0d6b0'), .35);
        const disc = kit.spawn(kit.template('soup_tomato')); disc.traverse(object => { if (object instanceof Mesh) object.material = view.liquidMaterial!; });
        disc.position.y = .04 + soup.fill * .13; g.add(disc);
        if (soup.burnt) add(['burnt'], 0, disc.position.y - .03, 0, .8);
        break;
      }
      case 'pan': add(['pan']); if (item.parts[0]) add(food(item.parts[0]), 0, .05, 0, .95); break;
      case 'extinguisher': add(['extinguisher']); break;
    }
  }
}
