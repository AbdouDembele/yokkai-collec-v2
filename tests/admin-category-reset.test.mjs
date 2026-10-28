import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(
  new URL("../app/admin/cards/admin-card-manager.tsx", import.meta.url),
  "utf8"
);
const ast = ts.createSourceFile(
  "admin.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
);
const field = ast.statements.find(
  node => ts.isFunctionDeclaration(node) && node.name?.text === "CategoryField"
);
const code = ts.transpileModule(
  `const NEW_CATEGORY="__new_category__";${field.getText(ast)};exports.CategoryField=CategoryField;`,
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.ReactJSX
    }
  }
).outputText;
const categories = ["ANIME/MANGA", "ARTIST", "COMICS", "VIDEO GAMES"];

function mount(initial) {
  let index = 0,
    tree,
    select;
  const state = [];
  const jsx = (type, props) => ({ type, props });
  const context = {
    exports: {},
    useState(value) {
      const key = index++;
      if (!Object.hasOwn(state, key)) state[key] = value;
      return [
        state[key],
        next => {
          state[key] = next;
        }
      ];
    },
    require: name => {
      assert.equal(name, "react/jsx-runtime");
      return { jsx, jsxs: jsx };
    }
  };
  vm.runInNewContext(code, context);
  const nodes = root =>
    root && typeof root === "object"
      ? [root, ...[root.props?.children].flat(Infinity).flatMap(nodes)]
      : [];
  const dom = { options: [], value: "" };
  const render = () => {
    index = 0;
    tree = context.exports.CategoryField({ categories, initial });
    select = nodes(tree).find(node => node.type === "select");
    const options = nodes(select).filter(node => node.type === "option");
    dom.options = options.map(node => ({
      value: node.props.value,
      disabled: !!node.props.disabled,
      defaultSelected: false
    }));
    dom.value = select.props.value;
    select.props.ref?.(dom);
  };
  // Native single-select form.reset(): use the default-selected option, or
  // the first enabled option when no default exists (the reported ANIME/MANGA bug).
  const reset = () => {
    dom.value =
      dom.options.findLast(option => option.defaultSelected)?.value ??
      dom.options.find(option => !option.disabled)?.value;
    return dom.value;
  };
  render();
  return {
    dom,
    reset,
    choose(value) {
      select.props.onChange({ target: { value } });
      render();
    },
    custom(value) {
      nodes(tree)
        .find(node => node.type === "input")
        .props.onChange({ target: { value } });
      render();
    },
    submitted() {
      return select.props.name === "categorie"
        ? dom.value
        : nodes(tree).find(
            node => node.type === "input" && node.props.name === "categorie"
          ).props.value;
    }
  };
}

test("une sauvegarde ne remplace pas visuellement COMICS par ANIME/MANGA, ni à la sauvegarde suivante", () => {
  const field = mount("COMICS");
  for (let i = 0; i < 3; i++) {
    assert.equal(field.submitted(), "COMICS");
    assert.equal(field.reset(), "COMICS");
  }
});

test("chaque changement de catégorie remplace entièrement la valeur de réinitialisation", () => {
  const field = mount("COMICS");
  for (const value of ["VIDEO GAMES", "ARTIST", "COMICS", "ANIME/MANGA"]) {
    field.choose(value);
    assert.equal(field.reset(), value);
    assert.equal(field.submitted(), value);
    assert.equal(
      field.dom.options.filter(option => option.defaultSelected).length,
      1
    );
  }
});

test("les catégories personnalisées restent affichées et transmises après réinitialisation", () => {
  const field = mount("UNLISTED");
  assert.equal(field.reset(), "__new_category__");
  assert.equal(field.submitted(), "UNLISTED");
  field.choose("COMICS");
  assert.equal(field.reset(), "COMICS");
  field.choose("__new_category__");
  field.custom("LITERATURE");
  assert.equal(field.reset(), "__new_category__");
  assert.equal(field.submitted(), "LITERATURE");
});

test("un formulaire de création sans catégorie ne sélectionne pas silencieusement ANIME/MANGA", () => {
  const field = mount("");
  assert.equal(field.reset(), "");
  assert.equal(field.submitted(), "");
});
