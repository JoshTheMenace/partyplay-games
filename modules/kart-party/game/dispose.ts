import { BufferGeometry, InstancedMesh, Line, Material, Mesh, Points, Texture, type Object3D } from 'three';

export function disposeObject(root:Object3D){
  const geometries=new Set<BufferGeometry>(),materials=new Set<Material>(),textures=new Set<Texture>();
  root.traverse(obj=>{
    if(!(obj instanceof Mesh||obj instanceof Points||obj instanceof Line))return;
    // Instance attributes belong to the mesh, not its geometry.
    if(obj instanceof InstancedMesh)obj.dispose();
    geometries.add(obj.geometry);
    for(const mat of Array.isArray(obj.material)?obj.material:[obj.material])materials.add(mat);
  });
  for(const geometry of geometries)geometry.dispose();
  for(const mat of materials){for(const value of Object.values(mat))if(value instanceof Texture)textures.add(value);mat.dispose();}
  for(const texture of textures)texture.dispose();
}
