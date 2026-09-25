/** Container screens (inventory with armor, crafting table, furnace, chest, villager trades), the recipe book and the creative palette. */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { HOTBAR_SIZE, INVENTORY_SIZE } from '../../shared/constants';
import { countItem } from '../../shared/inventory';
import { ARMOR_PIECES, B, I, ITEM_LIST, itemName, type ItemCategory, type Slot } from '../../shared/items';
import type { TradeOffer } from '../../shared/protocol';
import { PROFESSIONS } from '../../shared/trades';
import { hud } from '../game/hud';
import { clickSlot, closeScreen, craftRecipe, creativePick, nearCraftingTable, selectSlot, sendCommand } from '../game/predict';
import { store } from '../store';
import { itemHint, offerState } from './format';
import { reachGoal, Toasts } from './hud';
import { ItemIcon, PlayerDoll } from './icons';
import { BOOK_TABS, filterRecipes, ingredientSummary, missingText, type BookEntry, type BookTab } from './recipe-book';
import { FloatingLayer, SlotButton, SlotFace, SlotGrid, slotLabel } from './slot';
import { relockPointer, toast, useStore, useTouchMode } from './state';

const wide = () => typeof matchMedia === 'function' && matchMedia('(min-width: 900px) and (min-height: 520px)').matches;

/** Modal sheet on the browser's top layer: Escape closes, focus stays inside, the held stack and toasts float above. */
export function Sheet({ title, className = '', tools, children, onClose }: { title: string; className?: string; tools?: ReactNode; children: ReactNode; onClose(): void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal?.();
    // Focus the sheet itself (not its first button) so opening it never flashes a focus ring; Tab moves inside.
    dialog?.focus({ preventScroll: true });
    return () => dialog?.close?.();
  }, []);
  return <dialog ref={ref} className={`bw-sheet ${className}`} aria-label={title} tabIndex={-1} onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className="bw-panel">
      <header className="bw-panel-head">
        <h2>{title}</h2>
        <div className="bw-panel-tools">{tools}<button type="button" className="bw-x" aria-label={`Close ${title.toLowerCase()}`} onClick={onClose}>×</button></div>
      </header>
      {children}
    </div>
    <Toasts/>
    <FloatingLayer/>
  </dialog>;
}
const closeAndResume = () => { closeScreen(); relockPointer(); };

/** Touch-only toggle that makes taps act like shift-clicks (quick move between containers). */
function QuickMove() {
  const on = useStore(store, s => s.quickMove), touchMode = useTouchMode();
  if (!touchMode) return null;
  return <button type="button" className="bw-chip" aria-pressed={on} onClick={() => store.set({ quickMove: !on })}>Quick move</button>;
}
function BookToggle({ open, onToggle }: { open: boolean; onToggle(): void }) {
  return <button type="button" className="bw-chip" aria-pressed={open} onClick={onToggle}><ItemIcon id={I.book}/>Recipes</button>;
}

/** The player's 27 main slots above the 9 hotbar slots (MC layout). */
function PlayerSlots() {
  const inv = useStore(store, s => s.inv);
  return <div className="bw-player-slots">
    <SlotGrid slots={inv} target="inv" from={HOTBAR_SIZE} count={INVENTORY_SIZE - HOTBAR_SIZE}/>
    <SlotGrid slots={inv} target="inv" from={0} count={HOTBAR_SIZE} className="bw-hotrow"/>
  </div>;
}
function Arrow({ progress }: { progress?: number }) {
  return <span className="bw-arrow" aria-hidden="true">{progress !== undefined && <i style={{ width: `${Math.round(progress * 100)}%` }}/>}</span>;
}
function CraftingGrid({ width }: { width: 2 | 3 }) {
  const grid = useStore(store, s => s.grid), out = useStore(store, s => s.out);
  return <div className="bw-crafting" aria-label={`Crafting grid ${width} by ${width}`}>
    <SlotGrid slots={grid} target="grid" columns={width} count={width * width}/>
    <Arrow/>
    <SlotButton slot={out} className="bw-output" label={out ? `Take ${slotLabel(out)}` : 'Crafting result (empty)'} onAct={b => clickSlot('out', 0, b)}/>
  </div>;
}

const ARMOR_SLOTS = ['Helmet', 'Chestplate', 'Leggings', 'Boots'] as const;
/** Worn armor, head to feet (MC column): only the matching piece fits; shift-click in the inventory puts armor on. */
function ArmorColumn({ armor }: { armor: readonly (Slot | null)[] }) {
  return <div className="bw-armor" role="group" aria-label="Armor">
    {ARMOR_PIECES.map((piece, i) => <SlotButton key={piece} slot={armor[i] ?? null} label={`${ARMOR_SLOTS[i]}: ${armor[i] ? slotLabel(armor[i]) : 'empty'}`}
      hint={<ItemIcon id={I[`iron_${piece}`]} className="bw-ghost"/>} onAct={b => clickSlot('armor', i, b)}/>)}
  </div>;
}

/** Inventory (armor, preview, 2×2) and crafting table (3×3) share one layout: recipe book beside (or instead of, on phones) the slots. */
function CraftingScreen({ width, armor, color = '#3fa7ff' }: { width: 2 | 3; armor?: readonly (Slot | null)[]; color?: string }) {
  const [book, setBook] = useState(wide);
  const title = width === 3 ? 'Crafting table' : 'Inventory';
  return <Sheet title={title} className="bw-craft-sheet" onClose={closeAndResume} tools={<><BookToggle open={book} onToggle={() => setBook(!book)}/><QuickMove/></>}>
    <div className="bw-screen" data-book={book}>
      {book && <RecipeBook table={width === 3}/>}
      <section className="bw-slots-panel">
        {armor ? <div className="bw-inv-top">
          <ArmorColumn armor={armor}/>
          <span className="bw-doll" aria-hidden="true"><PlayerDoll color={color} armor={armor}/></span>
          <CraftingGrid width={2}/>
        </div> : <CraftingGrid width={width}/>}
        <PlayerSlots/>
      </section>
    </div>
  </Sheet>;
}
export const InventoryScreen = ({ armor, color }: { armor: readonly (Slot | null)[]; color: string }) => <CraftingScreen width={2} armor={armor} color={color}/>;
export const TableScreen = () => <CraftingScreen width={3}/>;

export function FurnaceScreen() {
  const screen = useStore(hud, s => s.screen);
  const slots: readonly (Slot | null)[] = screen?.kind === 'furnace' ? screen.slots : [null, null, null];
  const burn = screen?.burnMax ? (screen.burn ?? 0) / screen.burnMax : 0, cook = screen?.cookMax ? (screen.cook ?? 0) / screen.cookMax : 0;
  return <Sheet title="Furnace" onClose={closeAndResume} tools={<QuickMove/>}>
    <section className="bw-slots-panel">
      <div className="bw-furnace">
        <div className="bw-furnace-in">
          <SlotButton slot={slots[0] ?? null} label={slots[0] ? `Smelting ${slotLabel(slots[0])}` : 'Input: ore or food to cook'} hint={<ItemIcon id={B.iron_ore} className="bw-ghost"/>} onAct={b => clickSlot('screen', 0, b)}/>
          <span className="bw-flame" role="img" aria-label={burn > 0 ? 'Burning' : 'No fuel burning'}><i style={{ height: `${Math.round(burn * 100)}%` }}/></span>
          <SlotButton slot={slots[1] ?? null} label={slots[1] ? `Fuel: ${slotLabel(slots[1])}` : 'Fuel: coal, wood or planks'} hint={<ItemIcon id={I.coal} className="bw-ghost"/>} onAct={b => clickSlot('screen', 1, b)}/>
        </div>
        <Arrow progress={cook}/>
        <SlotButton slot={slots[2] ?? null} className="bw-output" label={slots[2] ? `Take ${slotLabel(slots[2])}` : 'Result (empty)'} onAct={b => clickSlot('screen', 2, b)}/>
      </div>
      <p className="bw-note">Ore goes on top, fuel below. Each item takes 10 seconds; smelting keeps going while you explore.</p>
      <PlayerSlots/>
    </section>
  </Sheet>;
}

export function ChestScreen() {
  const screen = useStore(hud, s => s.screen), slots = screen?.kind === 'chest' ? screen.slots : [];
  return <Sheet title="Chest" onClose={closeAndResume} tools={<QuickMove/>}>
    <section className="bw-slots-panel">
      <SlotGrid slots={slots} target="screen" count={27} className="bw-chest"/>
      <p className="bw-note">Shared with everyone in the world.</p>
      <PlayerSlots/>
    </section>
  </Sheet>;
}

const amount = (slot: Slot) => `${slot.n} ${itemName(slot.id)}`;
function OfferRow({ offer, inv, onTrade }: { offer: TradeOffer; inv: readonly (Slot | null)[]; onTrade(max: boolean): void }) {
  const state = offerState(offer, inv), deal = `${[offer.buy, offer.buyB].filter(pay => !!pay).map(amount).join(' and ')} for ${amount(offer.sell)}`;
  const pay = (slot: Slot) => <span className="bw-deal" data-short={state === 'short' && countItem(inv, slot.id) < slot.n} title={amount(slot)}><SlotFace slot={slot}/></span>;
  return <li className="bw-offer" data-state={state} title={deal}>
    <span className="bw-offer-deal">
      {pay(offer.buy)}{offer.buyB && <><b className="bw-plus" aria-hidden="true">+</b>{pay(offer.buyB)}</>}
      <Arrow/>
      <span className="bw-deal" title={amount(offer.sell)}><SlotFace slot={offer.sell}/></span>
      <span className="bw-offer-name">{itemName(offer.sell.id)}</span>
    </span>
    <small className="bw-offer-left">{state === 'sold' ? 'Sold out' : `${offer.left} left`}</small>
    <button type="button" className="bw-offer-go" disabled={state !== 'ready'} aria-label={`Trade ${deal}`} onClick={() => onTrade(false)}>Trade</button>
    <button type="button" className="bw-recipe-all" disabled={state !== 'ready'} aria-label={`Trade all: ${deal}`} onClick={() => onTrade(true)}>All</button>
  </li>;
}
/** Villager trades: payment comes from the inventory and the goods go straight into it. Trade once, or All for as many as you can afford. */
export function TradeScreen({ worldId }: { worldId: string }) {
  const screen = useStore(hud, s => s.screen), inv = useStore(store, s => s.inv);
  const trade = screen?.kind === 'trade' ? screen : null, offers = trade?.offers ?? [];
  const wallet = [...new Set(offers.flatMap(offer => offer.buyB ? [offer.buy.id, offer.buyB.id] : [offer.buy.id]))];
  const run = (i: number, max: boolean) => {
    sendCommand(max ? { t: 'trade', i, max: true } : { t: 'trade', i });
    reachGoal(worldId, 'trade');
  };
  return <Sheet title={PROFESSIONS[trade?.profession ?? -1] ?? 'Villager'} className="bw-trade-sheet" onClose={closeAndResume}>
    {offers.length ? <ul className="bw-offers" aria-label="Offers">{offers.map((offer, i) => <OfferRow key={i} offer={offer} inv={inv} onTrade={max => run(i, max)}/>)}</ul>
      : <p className="bw-empty">This villager has nothing to trade right now.</p>}
    {!!wallet.length && <p className="bw-wallet">You have {wallet.map(id => <span key={id} title={itemName(id)}><ItemIcon id={id}/>{countItem(inv, id)}</span>)}</p>}
    <p className="bw-note">Sold-out offers restock at dawn.</p>
  </Sheet>;
}

function RecipeRow({ entry, inv, nearTable }: { entry: BookEntry; inv: readonly (Slot | null)[]; nearTable: boolean }) {
  const { recipe, craftable, needsTable } = entry, name = itemName(recipe.out.id);
  const missing = craftable ? '' : missingText(recipe, inv, nearTable);
  return <li className="bw-recipe" data-craftable={craftable}>
    <button type="button" className="bw-recipe-main" title={missing ? `Missing: ${missing}` : `Craft ${name} (Shift: craft all)`}
      aria-label={craftable ? `Craft ${recipe.out.n > 1 ? `${recipe.out.n} ` : ''}${name}` : `${name}: missing ${missing}`}
      onClick={event => craftable ? craftRecipe(recipe.id, event.shiftKey) : toast(`${name} needs ${missing}`)}>
      <span className="bw-recipe-out"><ItemIcon id={recipe.out.id}/>{recipe.out.n > 1 && <b className="bw-count">{recipe.out.n}</b>}</span>
      <span className="bw-recipe-text">
        <b>{name}</b>
        <span className="bw-needs">
          {ingredientSummary(recipe, inv).map(need => <span key={need.ids.join()} className={need.have < need.n ? 'bw-miss' : ''}><ItemIcon id={need.ids[0]!}/>{need.n}</span>)}
          {needsTable && <em>+ table</em>}
        </span>
      </span>
    </button>
    {craftable && <button type="button" className="bw-recipe-all" aria-label={`Craft all ${name}`} onClick={() => craftRecipe(recipe.id, true)}>All</button>}
  </li>;
}
/** Recipe book: category tabs, search, "can craft" filter; tap to craft once, All (or Shift) to craft as many as possible. */
function RecipeBook({ table }: { table: boolean }) {
  const inv = useStore(store, s => s.inv), [tab, setTab] = useState<BookTab>('all'), [query, setQuery] = useState(''), [craftableOnly, setCraftableOnly] = useState(false);
  const nearTable = table || nearCraftingTable();
  const entries = useMemo(() => filterRecipes(inv, { tab, query, craftableOnly, nearTable }), [inv, tab, query, craftableOnly, nearTable]);
  return <section className="bw-book" aria-label="Recipe book">
    <div className="bw-tabs" role="tablist" aria-label="Recipe categories">
      {BOOK_TABS.map(t => <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} aria-label={t.label} title={t.label} onClick={() => setTab(t.id)}><ItemIcon id={t.icon}/></button>)}
    </div>
    <div className="bw-book-tools">
      <input type="search" className="bw-search" placeholder="Search recipes" aria-label="Search recipes" value={query} onChange={event => setQuery(event.target.value)}/>
      <button type="button" className="bw-chip" aria-pressed={craftableOnly} onClick={() => setCraftableOnly(!craftableOnly)}>Can craft</button>
    </div>
    {entries.length ? <ul className="bw-recipes">{entries.map(entry => <RecipeRow key={entry.recipe.id} entry={entry} inv={inv} nearTable={nearTable}/>)}</ul>
      : <p className="bw-empty">{craftableOnly ? 'Nothing craftable yet. Gather logs, stone and ore.' : 'No recipes match.'}</p>}
  </section>;
}

const CREATIVE_TABS: readonly { id: ItemCategory; label: string; icon: number }[] = [
  { id: 'building', label: 'Building', icon: B.bricks }, { id: 'decoration', label: 'Decoration', icon: B.lantern }, { id: 'nature', label: 'Nature', icon: B.grass_block },
  { id: 'tools', label: 'Tools', icon: I.diamond_pickaxe }, { id: 'combat', label: 'Combat', icon: I.diamond_sword }, { id: 'food', label: 'Food', icon: I.apple },
  { id: 'materials', label: 'Materials', icon: I.diamond }, { id: 'redstone', label: 'Redstone', icon: I.redstone }, { id: 'nether', label: 'Nether', icon: B.netherrack },
];
const PALETTE = ITEM_LIST.filter(item => !item.hidden);
/** Creative palette: tap an item to fill the selected hotbar slot with a full stack. */
export function CreativeScreen() {
  const [tab, setTab] = useState<ItemCategory>('building'), [query, setQuery] = useState('');
  const inv = useStore(store, s => s.inv), selected = useStore(store, s => s.selected), q = query.trim().toLowerCase();
  const items = PALETTE.filter(item => q ? item.name.toLowerCase().includes(q) : item.category === tab);
  return <Sheet title="Creative" className="bw-creative-sheet" onClose={closeAndResume}
    tools={<button type="button" className="bw-chip" onClick={() => store.set({ screen: 'inventory' })}>Inventory</button>}>
    <div className="bw-tabs" role="tablist" aria-label="Item categories">
      {CREATIVE_TABS.map(t => <button key={t.id} type="button" role="tab" aria-selected={!q && tab === t.id} aria-label={t.label} title={t.label} onClick={() => { setTab(t.id); setQuery(''); }}><ItemIcon id={t.icon}/></button>)}
      <input type="search" className="bw-search" placeholder="Search items" aria-label="Search items" value={query} onChange={event => setQuery(event.target.value)}/>
    </div>
    <div className="bw-palette">
      {items.map(item => <button key={item.id} type="button" className="bw-slot" title={[item.name, itemHint(item.id)].filter(Boolean).join(': ')} aria-label={`${item.name}: put in slot ${selected + 1}`} onClick={() => creativePick(item.id, selected)}><ItemIcon id={item.id}/></button>)}
      {!items.length && <p className="bw-empty">No items match.</p>}
    </div>
    <p className="bw-note">Tap an item to fill the highlighted hotbar slot. Tap a hotbar slot (or press 1–9) to choose it.</p>
    <div className="bw-slots bw-hotrow" role="toolbar" aria-label="Hotbar" style={{ gridTemplateColumns: 'repeat(9, var(--bw-slot))' }}>
      {inv.slice(0, HOTBAR_SIZE).map((slot, i) => <button key={i} type="button" className="bw-slot" aria-pressed={i === selected} aria-label={`Slot ${i + 1}: ${slotLabel(slot)}`} onClick={() => selectSlot(i)}><SlotFace slot={slot}/></button>)}
    </div>
  </Sheet>;
}
