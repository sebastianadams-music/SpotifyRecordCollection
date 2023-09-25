/* 

pseudocode:

Login() -> already handled
CheckWhetherPlaylistExists()
  If not:
  CreatePlaylist()
LoadAlbumsInPlayList()

SearchForAlbums()
(display in record collection)

onclick: AddAlbumtoPlaylist()
(redisplay all albums)



*/






window.retrieveElvis = function retrieveElvis(){

  var Spotify = require('spotify-web-api-js');
  var spotifyApi = new Spotify();
  spotifyApi.setAccessToken(localStorage.access_token);

// get Elvis' albums, passing a callback. When a callback is passed, no Promise is returned
spotifyApi.getArtistAlbums('43ZHCT0cAZBISjO8DG9PnE', function (err, data) {
  if (err) console.error(err);
  else console.log('Artist albums', data);
});

}


// browserify index.js -o bundle.js

var prev = null;

window.onUserInput = function onUserInput() {

var queryTerm = document.getElementById('myInput').value

console.log("running")

var Spotify = require('spotify-web-api-js');
var spotifyApi = new Spotify();
spotifyApi.setAccessToken(localStorage.access_token);

  // abort previous request, if any
  if (prev !== null) {
    prev.abort();
  }

  // store the current promise in case we need to abort it
  prev = spotifyApi.searchAlbums(queryTerm, { limit: 5 });

  console.log("bom")
  prev.then(
    function (data) {
      // clean the promise so it doesn't call abort
      prev = null;

      console.log("bim")
      
      let albums = data.albums.items 

      console.log(albums.length)

      document.getElementById("img_display").innerHTML = ""

      for (const a in albums) {

        let album = albums[a]
        console.log("album data: ", album)

        console.log("Album name: ", album.name)
        console.log("First Artist: ", album.artists[0].name)
        console.log("ID: ", album.id)
        var image = album.images[0]
        console.log("Image: ", image)
        displayImage("img_display", image.url, 120, 120, album.id) 

      } 

    
      // console.log("Album name: ", albums[1].name)
      // console.log("First Artist: ", albums[1].artists[0].name)
      // console.log("ID: ", albums[1].id)
      // var image = albums[1].images[0]
      // console.log("Image: ", image)
      // console.log("Album data: ", albums[1])
      // displayImage(image.url, image.width, image.height) 


      // ...render list of search results...
    },
    function (err) {
      console.error(err);
    }
  );
}



function displayImage(domLocation, src, width, height, id) {
  var img = document.createElement("img");
  img.src = src;
  console.log(img.src)
  img.width = width;
  img.height = height;
  img.id = id
  img.onclick = onAlbumImageClick
  document.getElementById(domLocation).appendChild(img);
 }

 function displayCollectionAlbum(domLocation, src, width, height, id, link) {
  var a=document.createElement('a');
  a.href = link
  var img = document.createElement("img");
  img.src = src;
  console.log(img.src)
  img.width = width;
  img.height = height;
  img.id = id
  a.appendChild(img)
  a.target ="_blank"
  document.getElementById(domLocation).appendChild(a);
 }


function onAlbumImageClick(event){
  // console.log(event.target.id)
  addAlbumToPlaylist(event.target.id)

  
}

function addAlbumToPlaylist(id){
  var Spotify = require('spotify-web-api-js');
  var spotifyApi = new Spotify();
  spotifyApi.setAccessToken(localStorage.access_token);

  spotifyApi.getAlbum(id)
    .then(function (data) {
      let listOfTracksToAdd = []
      let playlist = localStorage.collectionId
      let tracks = data.tracks.items
      console.log("tracks: ", tracks)
      for (track in tracks) {
        console.log("go: ", tracks[track].uri)
        listOfTracksToAdd.push(tracks[track].uri)
      }
      spotifyApi.addTracksToPlaylist(playlist, listOfTracksToAdd).then(
        ()=>{getAlbumsInPlaylist()}
      )
    })


}


  


window.getAlbumsInPlaylist = async function getAlbumsInPlaylist(){
  let trackdata = []
  var Spotify = require('spotify-web-api-js');
  var spotifyApi = new Spotify();
  spotifyApi.setAccessToken(localStorage.access_token);
  let playlist = localStorage.collectionId
  let data = await spotifyApi.getPlaylistTracks(playlist)
  let url = data.next
  console.log(data)
  trackdata.push(...data.items)

  while (url) {
    data = await spotifyApi.getPlaylistTracks(playlist, {'offset': data.offset + data.limit})
    url = data.next
    console.log(data)
    trackdata.push(...data.items)

  }
  let trackAlbumIds = new Set() // using a set as a quick (hopefully efficient) way to get only the unique IDs. 
  let albumInfo = []
  let setSize = 0 
  
  for (item in trackdata){
    trackAlbumIds.add(trackdata[item].track.album.id)
    if (trackAlbumIds.size > setSize){
      setSize += 1
      albumInfo.push(
        {
          "id": trackdata[item].track.album.id,
          "name": trackdata[item].track.album.name,
          "img_url": trackdata[item].track.album.images[0].url,
          "link": trackdata[item].track.album.external_urls.spotify
        }
      )

    }

  }

  console.log(trackAlbumIds)
  console.log(albumInfo)
  document.getElementById("collection").innerHTML = ""
  for (x in albumInfo){
    let item = albumInfo[x]
    displayCollectionAlbum("collection", item.img_url, 120, 120, item.id, item.link) 

  }




}

window.createNewPlaylist = async function createNewPlaylist(){
  let collectionExists = await getPlaylists()
    if (!collectionExists){

      var Spotify = require('spotify-web-api-js');
      var spotifyApi = new Spotify();
      spotifyApi.setAccessToken(localStorage.access_token);
    spotifyApi.createPlaylist(localStorage.loggedInSpotifyId, {
      "name": "My Spotify Record Collection",
      "description": "Automatically created by the SpotifyRecordCollection app to manage your collection of albums.",
      "public": false
    }
      
      
      ).then(
        function (data) {
          console.log('Private Playlist Created: ', data);
        },
        function (err) {
          console.error(err);
        }
      )
      
    }
    else {
      console.log("playlist already exists")
    }

}

window.getPlaylists = async function getPlaylists() {
  var Spotify = require('spotify-web-api-js');
  var spotifyApi = new Spotify();
  spotifyApi.setAccessToken(localStorage.access_token);
  let playListArray = []
  let data = await spotifyApi.getUserPlaylists({'offset': 0})
  let url = data.next
  playListArray.push(...data.items)

  while (url) {
    data = await spotifyApi.getUserPlaylists({'offset': data.offset + data.limit})
    url = data.next
    playListArray.push(...data.items)
  }
  let playListNames = []
  for (item in playListArray){
    playListNames.push(playListArray[item].name)
  }
  let recordCollectionExists = playListNames.includes("My Spotify Record Collection")
  let collectionIndex = playListNames.indexOf("My Spotify Record Collection")
  console.log("recordCollectionExists: ", recordCollectionExists)
  localStorage.collectionId = playListArray[collectionIndex].id
  return recordCollectionExists
}
