import { neutral, type Input } from './model';
export const controls = { input:neutral(), publish:(_input:Input)=>{}, release:()=>{} };
export function changeInput(part:Partial<Input>) { controls.input={...controls.input,...part,looking:true};controls.publish(controls.input); }
export function resetInput() { controls.input={...neutral(),yaw:controls.input.yaw,pitch:controls.input.pitch,slot:controls.input.slot,fly:controls.input.fly,command:controls.input.command};controls.release(); }
