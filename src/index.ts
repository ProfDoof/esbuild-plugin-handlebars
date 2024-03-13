import handlebars from "handlebars";
import { PluginBuild, OnLoadOptions } from "esbuild";
import { stat, readFile } from "fs/promises";

const fileCache = new Map();

// @ts-ignore
class ESBuildHandlebarsJSCompiler extends handlebars.JavaScriptCompiler {
  foundHelpers: Set<string> = new Set();
  foundPartials: Set<string> = new Set();

  constructor() {
    super(...arguments);
  }
  public compiler: typeof ESBuildHandlebarsJSCompiler = ESBuildHandlebarsJSCompiler;
  nameLookup(parent, name: string, type) {
    if (type === "helper") {
      this.foundHelpers.add(name);
    } else if (type == "partial") {
      this.foundPartials.add(name);
    }
    return super.nameLookup(parent, name, type);
  }
}

const onloadOpt: OnLoadOptions = {
  filter: /\.(hbs|handlebars)$/i,
};

function hbs(options: { additionalHelpers: any; additionalPartials: any; precompileOptions: any } = { additionalHelpers: {}, additionalPartials: {}, precompileOptions: {} }) {
  const { additionalHelpers = {}, additionalPartials = {}, precompileOptions = {} } = options;
  return {
    name: "handlebars",
    setup(build: PluginBuild) {
      const hb: any  = handlebars.create();
      hb.JavaScriptCompiler = ESBuildHandlebarsJSCompiler;
      build.onLoad(onloadOpt, async ({ path: filename }) => {
        if (fileCache.has(filename)) {
          const cachedFile = fileCache.get(filename) || {
            data: null,
            modified: new Date(0),
          };
          let cacheValid = true;
          try {
            // Check that mtime isn't more recent than when we cached the result
            if ((await stat(filename)).mtime > cachedFile.modified) {
              cacheValid = false;
            }
          } catch {
            cacheValid = false;
          }
          if (cacheValid) {
            return cachedFile.data;
          } else {
            // Not valid, so can be deleted
            fileCache.delete(filename);
          }
        }

        const source = await readFile(filename, "utf-8");
        const knownHelpers = Object.keys(additionalHelpers).reduce((prev: any, helper: string) => {
          prev[helper] = true;
          return prev;
        }, {});

        // Compile options
        const compileOptions = {
          ...precompileOptions,
          knownHelpersOnly: true,
          knownHelpers,
        };

        try {
          const foundHelpers: Set<string> = hb.JavaScriptCompiler.foundHelpers;
          const foundPartials: Set<string> = hb.JavaScriptCompiler.foundPartials;
          const template = hb.precompile(source, compileOptions);
          const foundAndMatchedHelpers = Array.from(foundHelpers).filter((helper) => Object.hasOwn(additionalHelpers, helper));
          const foundAndMatchedPartials = Array.from(foundPartials).filter((partial) => Object.hasOwn(additionalPartials, partial));
          const contents = [
            "import * as Handlebars from 'handlebars/runtime';",
            ...foundAndMatchedHelpers.map((helper) => `import ${helper} from '${additionalHelpers[helper]}';`),
            ...foundAndMatchedPartials.map((partial) => `import ${partial} from '${additionalPartials[partial]}';`),
            `Handlebars.registerHelper({${foundAndMatchedHelpers.join()}});`,
            `Handlebars.registerPartial({${Object.keys(additionalPartials).join()}});`,
            `export default Handlebars.template(${template});`,
          ].join("\n");
          return { contents };
        } catch (err: any) {
          const esBuildError = { text: err.message };
          return { errors: [esBuildError] };
        }
      });
    },
  };
}
module.exports = hbs;
