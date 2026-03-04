export enum ProjectType {
  Vue = 'vue',
  WxMiniProgram = 'wx',
  Unknown = 'unknown',
}

export interface PropInfo {
  name: string;
  type?: string;
  required?: boolean;
}

export interface ComponentInfo {
  name: string;
  importPath: string;
  resolvedPath?: string;
  props?: PropInfo[];
  isGlobal?: boolean;
}

export interface ParsedVueSfc {
  components: Map<string, string>;
  imports: Map<string, string>;
  props: PropInfo[];
  dataKeys: string[];
  computedKeys: string[];
  methodKeys: string[];
}

export interface ParsedWxComponent {
  usingComponents: Map<string, string>;
  properties: PropInfo[];
  dataKeys: string[];
  methodKeys: string[];
}
