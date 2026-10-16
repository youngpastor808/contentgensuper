const pkgName = 'ffmpeg-static';
console.log("Before import");
const staticMod = await import(pkgName).catch((e) => {
    console.log("Caught:", e.message);
    return null;
});
console.log("After import:", staticMod);
