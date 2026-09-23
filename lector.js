/* Lector de registros: entiende "pechuga de pollo 150 g y una taza de arroz" sin IA.

   Busca cada alimento en tus productos (mis_comidas.json) y en la tabla estándar del USDA
   (alimentos.json), lee la cantidad que escribiste y calcula los nutrientes. Todo en el
   teléfono, sin red, en milisegundos. Lo que no reconoce lo devuelve aparte, para la IA.

   Nunca decide solo lo que importa para tu salud: si el texto habla de glucosa, presión,
   síntomas, dolor, remedios u otro día, lo manda entero a la IA, que aplica las reglas
   de seguridad. */
(function (raiz) {
  "use strict";

  const CAMPOS = ["proteina_g", "carbohidratos_g", "grasa_g", "kcal", "sodio_mg",
                  "fibra_g", "potasio_mg", "magnesio_mg", "vitamina_d_ug"];
  const NUMEROS = {un: 1, una: 1, uno: 1, medio: 0.5, media: 0.5, dos: 2, tres: 3, cuatro: 4, cinco: 5,
                   seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, doce: 12, quince: 15, veinte: 20};
  const PESO = {g: 1, gr: 1, grs: 1, gramo: 1, gramos: 1, kg: 1000, kilo: 1000, kilos: 1000,
                ml: 1, cc: 1, litro: 1000, litros: 1000};
  // Palabras de envase o medida: "1 taza" no es una unidad del alimento, es una medida.
  const MEDIDAS = new Set(["taza", "cucharada", "cucharadita", "vaso", "plato", "punado", "porcion", "lata",
    "copa", "rebanada", "lamina", "tajada", "schop", "botella", "scoop", "sachet", "pote", "chorrito", "mitad"]);
  const RELLENO = new Set(["comi", "almorce", "desayune", "cene", "tome", "meriende", "me", "de", "del", "el", "la",
    "lo", "los", "las", "hoy", "al", "en", "a", "mi", "mis", "unos", "unas", "poco", "algo", "otro", "otra", "mas",
    "y", "con", "sal", "pimienta", "oregano", "merken", "alino", "vinagre", "ajo", "postre", "almuerzo",
    "desayuno", "cena", "once", "colacion", "tambien", "solo", "sola", "que", "fue", "era", "para", "aprox",
    "aproximadamente", "como", "cocido", "cocida", "cocidos", "cocidas", "natural", "casero", "casera", "rico", "rica",
    "comun", "pizca", "ensalada", "mediano", "mediana", "grande", "chico", "chica", "pequeno", "pequena"]);
  // Estos separan alimentos distintos: no se cruzan al juntar "pechuga de pollo".
  const SEPARADORES = new Set([",", "y", "con", "+"]);
  // Palabras genéricas que, pegadas a un producto tuyo, son ese producto: "yogurt Soprole" es 1 Soprole.
  const CATEGORIAS = new Set(["yogurt", "yogur", "yoghurt", "queso", "pan", "leche", "barra", "bebida"]);
  // Esto lo decide la IA, no el lector: fechas, mediciones y síntomas tienen reglas de seguridad.
  const PARA_LA_IA = [
    [/\b(ayer|anoche|anteayer|lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b|\bel \d{1,2} de\b/, "habla de otro día"],
    [/\b(glucosa|glicemia|hipoglucemia|insulina)\b/, "glucosa"],
    [/\b(presion|pulso|tension)\b/, "presión"],
    [/\b(peso|pese|pesaje)\b/, "peso"],
    [/\b(dormi|sueno|desperte|insomnio)\b/, "sueño"],
    [/\b(entrene|gym|gimnasio|trote|trotar|corri|camine|pesas|ejercicio|kaito)\b/, "entrenamiento"],
    [/\b(sacro|dolor|duele|mareo|mareado|palpitaciones|taquicardia|sintoma|sintomas|nausea|fiebre)\b/, "síntomas"],
    [/\b(remedio|medicamento|pastilla|dosis|empece|deje|recetaron|cambiaron)\b/, "remedios"],
    [/\bno (es|era|fue)\b|\berror\b|\bcorrig|\ben vez de\b|\bborra|\belimina|\bquita\b|\banterior\b/, "corrección"],
  ];

  const normalizar = t => (t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/½/g, " 1/2 ").replace(/(\d)([a-z])/g, "$1 $2").replace(/[^a-z0-9ñ/.,\s]/g, " ")
    .replace(/(\D)[.,]|[.,](\D)|[.,]$/g, "$1 $2").replace(/\s+/g, " ").trim();
  const singular = p => p.length > 4 && p.endsWith("es") && !p.endsWith("ches") ? p.slice(0, -2)
                      : p.length > 3 && p.endsWith("s") ? p.slice(0, -1) : p;

  function numero(tok) {
    if (tok in NUMEROS) return NUMEROS[tok];
    let m = tok.match(/^(\d+)\/(\d+)$/);
    if (m) return +m[1] / +m[2];
    m = tok.match(/^\d+(?:[.,]\d+)?$/);
    return m ? parseFloat(tok.replace(",", ".")) : null;
  }

  // Cuántas "unidades" dice la etiqueta de una porción: "1/2 palta" = 0,5; "4 mitades" = 4.
  function cuentaDeEtiqueta(etiqueta) {
    const primero = normalizar(etiqueta).split(" ")[0];
    const n = numero(primero);
    return n || 1;
  }

  function preparar(catalogos) {
    // Cada sinónimo, normalizado, apuntando a su alimento. Tus productos van primero:
    // ante un empate de largo, gana lo tuyo.
    const entradas = [];
    for (const [fuente, lista] of catalogos) {
      for (const a of lista || []) {
        for (const s of new Set([...(a.buscar || []), a.nombre].map(normalizar))) {
          if (s) entradas.push({sinonimo: s.split(" "), alimento: a, fuente});
        }
      }
    }
    entradas.sort((x, y) => y.sinonimo.length - x.sinonimo.length || y.sinonimo.join(" ").length - x.sinonimo.join(" ").length);
    return entradas;
  }

  function calzaEn(tokens, i, sinonimo) {
    for (let k = 0; k < sinonimo.length; k++) {
      const t = tokens[i + k];
      if (t === undefined) return false;
      if (t !== sinonimo[k] && singular(t) !== singular(sinonimo[k])) return false;
    }
    return true;
  }

  // Lee una cantidad en tokens[desde..hasta): "150 g", "1 taza", "media", "4", "medio punado".
  function leerCantidad(tokens, desde, hasta) {
    for (let i = desde; i < hasta; i++) {
      const n = numero(tokens[i]);
      const u = tokens[i + 1] !== undefined && i + 1 < hasta ? singular(tokens[i + 1]) : null;
      if (n !== null) {
        if (u && u in PESO) return {cantidad: n, unidad: u, desde: i, hasta: i + 2};
        if (u && MEDIDAS.has(u)) return {cantidad: n, unidad: u, desde: i, hasta: i + 2};
        return {cantidad: n, unidad: null, desde: i, hasta: i + 1};
      }
      if (MEDIDAS.has(singular(tokens[i]))) {
        return {cantidad: 1, unidad: singular(tokens[i]), desde: i, hasta: i + 1};
      }
    }
    return null;
  }

  function gramosPara(alimento, cant, trasCon) {
    const porciones = alimento.porciones || [];
    const pordefecto = porciones[0];
    if (!cant) {
      const p = (trasCon && alimento.acompanamiento) || pordefecto;
      return p ? {gramos: p[1], texto: p[0], asumido: true} : null;
    }
    if (cant.unidad && cant.unidad in PESO) {
      const g = cant.cantidad * PESO[cant.unidad];
      return {gramos: g, texto: `${+g.toFixed(1)} g`, asumido: false};
    }
    if (cant.unidad) {
      const i = porciones.findIndex(([et]) => normalizar(et).split(" ").map(singular).includes(cant.unidad));
      if (i >= 0) {
        const p = porciones[i];
        const g = cant.cantidad * p[1] / cuentaDeEtiqueta(p[0]);
        const palabra = p[0].split(" ").find(w => singular(normalizar(w)) === cant.unidad) || cant.unidad;
        return {gramos: g, texto: `${fmt(cant.cantidad)} ${cant.cantidad > 1 ? plural(palabra) : palabra}`, asumido: false};
      }
      if (!pordefecto) return null;
      return {gramos: cant.cantidad * pordefecto[1], texto: veces(cant.cantidad, pordefecto[0]), asumido: true};
    }
    // Solo un número: "4 huevos", "media palta", "5 frutillas".
    const unidad = porciones.find(([et]) => cuentaDeEtiqueta(et) === 1 &&
      !MEDIDAS.has(singular(normalizar(et).split(" ")[1] || "")));
    const p = unidad || pordefecto;
    if (!p) return null;
    let texto = veces(cant.cantidad, p[0]);
    if (unidad) {
      const [nombre, ...resto] = p[0].split(" ").slice(1);
      texto = [fmt(cant.cantidad), cant.cantidad > 1 ? plural(nombre) : nombre, ...resto].join(" ");
    }
    return {gramos: cant.cantidad * p[1] / cuentaDeEtiqueta(p[0]), texto, asumido: !unidad};
  }

  const plural = w => /z$/i.test(w) ? w.slice(0, -1) + "ces"
                    : /[aeiouáéó]$/i.test(w) ? w + "s" : /s$/i.test(w) ? w : w + "es";
  // "2 × 1 vaso" se lee mejor como "2 vasos".
  const veces = (n, etiqueta) => {
    if (n === 1) return etiqueta;
    const [primero, nombre, ...resto] = etiqueta.split(" ");
    return primero === "1" && nombre ? [fmt(n), plural(nombre), ...resto].join(" ") : `${fmt(n)} × ${etiqueta}`;
  };

  function fmt(n) {
    const f = {0.5: "1/2", 0.25: "1/4", 0.75: "3/4"}[n];
    if (f) return f;
    if (Math.abs(n - 1 / 3) < 1e-9) return "1/3";
    if (Math.abs(n - 2 / 3) < 1e-9) return "2/3";
    return String(+n.toFixed(2));
  }

  function leer(texto, preparado) {
    const norm = normalizar(texto);
    for (const [re, motivo] of PARA_LA_IA) {
      if (re.test(norm)) return {ruta: "ia", motivo, items: [], noEntendido: []};
    }
    // "sin azúcar", "sin sal": no se come, se descarta antes de buscar.
    const tokens = norm.replace(/\bsin \S+/g, " ").replace(/[,;]/g, " , ").split(/\s+/).filter(Boolean);

    // 1) Encontrar los alimentos: el sinónimo más largo gana, sin solaparse.
    const usados = new Array(tokens.length).fill(false);
    const hallados = [];
    for (const e of preparado) {
      for (let i = 0; i + e.sinonimo.length <= tokens.length; i++) {
        let libre = true;
        for (let k = 0; k < e.sinonimo.length; k++) if (usados[i + k]) { libre = false; break; }
        if (libre && calzaEn(tokens, i, e.sinonimo)) {
          for (let k = 0; k < e.sinonimo.length; k++) usados[i + k] = true;
          hallados.push({i, fin: i + e.sinonimo.length, alimento: e.alimento, fuente: e.fuente});
        }
      }
    }
    hallados.sort((a, b) => a.i - b.i);

    // "pechuga de pollo" son dos sinónimos del MISMO alimento; "yogurt soprole" es un producto tuyo
    // con su categoría delante. En ambos casos es una sola cosa, no dos.
    const soloRelleno = (a, b) => tokens.slice(a, b).every(t => RELLENO.has(t) && !SEPARADORES.has(t));
    for (let h = 0; h + 1 < hallados.length; h++) {
      const x = hallados[h], y = hallados[h + 1];
      if (!soloRelleno(x.fin, y.i)) continue;
      const esCategoria = z => tokens.slice(z.i, z.fin).every(t => CATEGORIAS.has(singular(t)) || CATEGORIAS.has(t));
      let queda = null;
      if (x.alimento.id === y.alimento.id) queda = x;
      else if (esCategoria(x) && y.fuente === "tuyo") queda = y;
      else if (esCategoria(y) && x.fuente === "tuyo") queda = x;
      if (queda) {
        hallados.splice(h, 2, {...queda, i: x.i, fin: y.fin});
        h--;
      }
    }

    // 2) Su cantidad: primero lo escrito antes ("150 g de pollo"), si no, lo de después ("pollo 150 g").
    const consumido = usados.slice();
    const items = [];
    let limite = 0;
    for (let h = 0; h < hallados.length; h++) {
      const x = hallados[h];
      const siguiente = h + 1 < hallados.length ? hallados[h + 1].i : tokens.length;
      let cant = leerCantidad(tokens, limite, x.i);
      if (cant && tokens.slice(cant.hasta, x.i).some(t => t === "," || t === "y" || t === "con")) cant = null;
      if (!cant) {
        const tras = leerCantidad(tokens, x.fin, siguiente);
        if (tras && !tokens.slice(x.fin, tras.desde).some(t => t === "," || t === "y" || t === "con")) cant = tras;
      }
      if (cant) for (let k = cant.desde; k < cant.hasta; k++) consumido[k] = true;
      const trasCon = tokens.slice(Math.max(0, x.i - 3), x.i).includes("con");
      const r = gramosPara(x.alimento, cant, trasCon);
      if (r) {
        const nutr = {};
        for (const c of CAMPOS) nutr[c] = Math.round(((x.alimento.por_100g || {})[c] || 0) * r.gramos / 10) / 10;
        items.push({id: x.alimento.id, nombre: x.alimento.nombre, gramos: Math.round(r.gramos * 10) / 10,
                    porcion: r.texto, asumido: r.asumido, fuente: x.fuente, nutrientes: nutr});
      }
      limite = Math.max(x.fin, cant && cant.desde >= x.fin ? cant.hasta : x.fin);
    }

    // 3) Lo que sobró y no es relleno: eso no lo entendí.
    const noEntendido = tokens.filter((t, i) => !consumido[i] && t !== "," && !RELLENO.has(t) &&
                                               !RELLENO.has(singular(t)) && numero(t) === null &&
                                               !(singular(t) in PESO) && !MEDIDAS.has(singular(t)) && t.length > 2);
    if (!items.length) return {ruta: "ia", motivo: "no reconocí ningún alimento", items, noEntendido};
    if (noEntendido.length) return {ruta: "ia", motivo: `no reconocí: ${noEntendido.join(", ")}`, items, noEntendido};
    return {ruta: "local", motivo: null, items, noEntendido};
  }

  function sumar(items) {
    const total = {};
    for (const c of CAMPOS) total[c] = Math.round(items.reduce((s, it) => s + (it.nutrientes[c] || 0), 0) * 10) / 10;
    return total;
  }

  // Cómo se muestra y se guarda cada ítem: "4 huevos", "1 taza de arroz blanco", "150 g de pechuga de pollo".
  function describir(it) {
    const corto = it.nombre.split(" (")[0].split(" / ")[0];
    const primera = singular(normalizar(corto).split(" ")[0]);
    const base = normalizar(it.porcion).split(" ").map(singular).includes(primera)
      ? it.porcion : `${it.porcion} de ${corto.toLowerCase()}`;
    return it.asumido ? `${base} (porción estándar)` : base;
  }

  const Lector = {CAMPOS, normalizar, preparar, leer, sumar, describir};
  if (typeof module !== "undefined" && module.exports) module.exports = Lector;
  else raiz.Lector = Lector;
})(typeof window !== "undefined" ? window : globalThis);
