/**
 * Rendu de la grille du portfolio à partir de photos.json.
 *
 * Chaque photo n'existe qu'une fois, dans photos.json — c'est le seul fichier
 * que l'automatisation n8n a besoin de modifier pour publier une nouvelle image.
 *
 * Les URLs Cloudinary sont construites ici, à la bonne taille : la grille reçoit
 * des vignettes de 400 à 1200 px (au lieu des 4000 px d'origine) et le plein
 * écran une version 2000 px. `f_auto` sert du WebP/AVIF quand le navigateur le
 * supporte, `q_auto` ajuste la compression image par image.
 */
(function () {
  "use strict";

  // Largeurs proposées au navigateur pour les vignettes de la grille.
  // Il choisit selon la taille d'affichage réelle et la densité de l'écran.
  // Les paliers sont resserrés autour des cas courants : une case fait environ
  // 320 px de large sur un écran de bureau, soit 640 px réels en haute densité.
  var GRID_WIDTHS = [320, 480, 640, 800, 1200];

  // Largeur de la version ouverte en plein écran (lightbox).
  var LIGHTBOX_WIDTH = 2000;

  // Nombre de vignettes chargées immédiatement : celles visibles sans scroller.
  // Les suivantes attendent que l'utilisateur s'approche (loading="lazy").
  var EAGER_COUNT = 4;

  /**
   * Construit une URL Cloudinary.
   * L'extension est conservée : certains identifiants contiennent des points
   * (« 2025.1.30 »), et l'omettre fait échouer certaines transformations.
   */
  function url(cloudName, photo, transform) {
    return (
      "https://res.cloudinary.com/" +
      cloudName +
      "/image/upload/" +
      transform +
      "/v" +
      photo.version +
      "/" +
      photo.id +
      "." +
      photo.format
    );
  }

  function gridSrc(cloudName, photo, width) {
    return url(cloudName, photo, "c_limit,w_" + width + ",f_auto,q_auto");
  }

  function buildTile(cloudName, photo, index) {
    var tile = document.createElement("a");
    tile.className = "tile";
    tile.href = url(
      cloudName,
      photo,
      "c_limit,w_" + LIGHTBOX_WIDTH + ",f_auto,q_auto:good"
    );
    tile.setAttribute("data-fancybox", "gallery");
    // Couleur dominante de la photo : occupe la case pendant le chargement,
    // ce qui évite le rectangle blanc et le saut de mise en page. Facultative —
    // sans elle, le gris neutre défini dans gallery.css prend le relais.
    if (photo.color) {
      tile.style.backgroundColor = photo.color;
    }
    // Sans dimensions, la case n'aurait pas de hauteur avant l'arrivée de
    // l'image et la page sauterait au chargement : on retombe sur du 3/2, le
    // format de la quasi-totalité des photos.
    var hasSize = photo.width > 0 && photo.height > 0;
    tile.style.aspectRatio = hasSize ? photo.width + " / " + photo.height : "3 / 2";

    var img = document.createElement("img");
    img.alt = photo.alt || "";
    if (hasSize) {
      img.width = photo.width;
      img.height = photo.height;
    }
    img.decoding = "async";

    // ATTENTION À L'ORDRE DES ATTRIBUTS CI-DESSOUS.
    //
    // Le navigateur fige sa stratégie de chargement au moment où src/srcset
    // sont définis. Tout ce qui l'influence doit donc être posé avant :
    //
    //  - loading après src : l'image reste bloquée, elle ne se charge jamais,
    //    même une fois visible à l'écran ;
    //  - sizes après srcset : la sélection se fait une première fois avec la
    //    valeur par défaut (100vw), donc sur la plus grande image, puis une
    //    seconde fois avec la bonne taille — deux téléchargements par vignette.
    //
    // Ordre correct : loading/fetchPriority, puis sizes, puis srcset, et src en
    // dernier comme repli pour les navigateurs sans srcset.
    if (index < EAGER_COUNT) {
      img.loading = "eager";
      img.fetchPriority = "high";
    } else {
      img.loading = "lazy";
    }
    img.sizes =
      "(min-width: 1024px) 25vw, (min-width: 768px) 33vw, (min-width: 640px) 50vw, 100vw";
    img.srcset = GRID_WIDTHS.map(function (w) {
      return gridSrc(cloudName, photo, w) + " " + w + "w";
    }).join(", ");
    img.src = gridSrc(cloudName, photo, 640);

    // Fondu à l'arrivée de l'image. `complete` couvre le cas d'une image déjà
    // en cache, où l'événement load ne se déclenche jamais.
    if (img.complete) {
      img.classList.add("is-loaded");
    } else {
      img.addEventListener("load", function () {
        img.classList.add("is-loaded");
      });
      // Sans ceci, une image en échec resterait invisible sur son aplat de couleur.
      img.addEventListener("error", function () {
        img.classList.add("is-loaded");
      });
    }

    tile.appendChild(img);
    return tile;
  }

  function render(data, container) {
    var fragment = document.createDocumentFragment();
    data.photos.forEach(function (photo, index) {
      fragment.appendChild(buildTile(data.cloudName, photo, index));
    });
    container.appendChild(fragment);

    if (typeof Fancybox !== "undefined") {
      Fancybox.bind('[data-fancybox="gallery"]', {});
    }
  }

  function init() {
    var container = document.getElementById("gallery");
    if (!container) return;

    fetch(container.dataset.source || "photos.json")
      .then(function (response) {
        if (!response.ok) throw new Error("HTTP " + response.status);
        return response.json();
      })
      .then(function (data) {
        render(data, container);
      })
      .catch(function (error) {
        console.error("Chargement de la galerie impossible :", error);
        container.insertAdjacentHTML(
          "beforeend",
          '<p class="gallery-error">Les photos n\'ont pas pu être chargées. Rafraîchissez la page.</p>'
        );
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
