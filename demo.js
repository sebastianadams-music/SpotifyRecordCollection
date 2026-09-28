const names = [
  ["Quiet Weather", "Alice June", "#b3bca3", "#e4dcc7"],
  ["Forms of Water", "Arlo Finch", "#d56947", "#ddd0ac"],
  ["The Long Way Home", "Bennet & Co.", "#484d41", "#d9d0b6"],
  ["Blue Hours", "Cass Vale", "#536f96", "#c1d9d3"],
  ["In the Garden", "Della Moss", "#d8c450", "#6b764d"],
  ["Soft Geometry", "Eli North", "#d5aa96", "#84332b"],
  ["Sunday Static", "Fable", "#6b7474", "#cbd2c0"],
  ["Night Swimming", "Fern & Field", "#3a4b58", "#d27749"],
  ["Almost Summer", "Iona", "#d1943f", "#e6d8a9"],
  ["Still Life", "Juniper", "#8e413d", "#dcbcb0"],
  ["Open Windows", "Kite Museum", "#718b76", "#d4ddb9"],
  ["Another Place", "Luca Grey", "#525975", "#cabecb"],
  ["Small Hours", "Martha Lake", "#d19d75", "#704a40"],
  ["A Good Distance", "North Parade", "#93884b", "#e6d9bc"],
  ["Understory", "Olive", "#4d6652", "#b4bb98"],
  ["Paper Moon", "Paloma", "#bf726b", "#e7cba9"],
];
export const demoAlbums = names.map(([name, artist, base, accent], index) => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300"><rect width="300" height="300" fill="${base}"/><circle cx="${90 + (index % 4) * 35}" cy="${100 + (index % 3) * 30}" r="${65 + (index % 4) * 12}" fill="${accent}"/><path d="M0 250L300 ${50 + index * 9}V300H0Z" fill="${base}" opacity=".65"/><text x="20" y="35" font-family="sans-serif" font-size="12" fill="${accent}" letter-spacing="3">${artist.toUpperCase().replaceAll("&", "&amp;")}</text><text x="20" y="274" font-family="serif" font-size="24" fill="${accent}">${name}</text></svg>`;
  return {
    id: `demo-${index}`,
    genres: [["folk"], ["ambient"], ["jazz"], ["indie rock"]][index % 4],
    name,
    artist,
    year: String(2005 + index),
    addedAt: `2026-09-${String(index + 1).padStart(2, "0")}`,
    image: `data:image/svg+xml,${encodeURIComponent(svg)}`,
    link: "#",
  };
});
