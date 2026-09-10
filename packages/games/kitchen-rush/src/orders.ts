import { RECIPES, type Ticket } from './model';

// Introduce the menu in order, then vary it without flooding a crew with one dish.
export function chooseRecipe(seed:number,index:number,menuSize:number,tickets:Ticket[]){
  const menu=RECIPES.slice(0,menuSize);if(index<menu.length)return menu[index];
  const available=menu.filter(recipe=>tickets.filter(t=>t.recipe===recipe.id).length<2),pool=available.length?available:menu;
  let random=(seed^Math.imul(index+1,0x9e3779b1))>>>0;random=Math.imul(random^(random>>>16),0x21f0aaad);random=Math.imul(random^(random>>>15),0x735a2d97);random=(random^(random>>>15))>>>0;
  return pool[random%pool.length];
}
