<?php

if ($_SERVER["REQUEST_METHOD"] == "POST" && !empty($_FILES["file"])) {
    $fn = $_FILES["file"]["name"]; // File name
    $ftyp = $_FILES["file"]["type"]; // File type
    $ftl = $_FILES["file"]["tmp_name"]; // Path of temporary file
    $ft = $_FILES["file"]["size"]; // File size
    $fem = $_FILES["file"]["error"]; // Errors if any

    // Check if file successfully uploaded or not in the temporary folder.
    if (!$ftl) {
        echo "ERROR: please browse for file before uploading";
        exit();
    }

    // Check for duplicate file names and renames the latest file in sequence if duplicates found.
    $originalDir = dirname(realpath(__FILE__)) . $_POST["folder"];
    $compressedDir = $originalDir . "compressed/";
    if (!is_dir($compressedDir)) {
        mkdir($compressedDir, 0755, true);
    }

    if (file_exists($originalDir . $fn)) {
        $fext = substr($fn, strrpos($fn, "."));
        $fntmp1 = substr($fn, 0, strrpos($fn, "."));
        $i = 1;
        do {
            $fntmp2 = $fntmp1 . " copy($i)" . $fext;
            $i++;
        } while (file_exists($originalDir . $fntmp2));
        $fn = $fntmp2;
    }

    // Moves uploaded file to the "images" directory from the temporary directory of the server.
    $dest = $originalDir . $fn;
    if ($ftyp == "image/jpeg" || $ftyp == "image/png" || $ftyp == "image/gif") {
        if (move_uploaded_file($ftl, $dest)) {
            // Compress and save the image
            compressImage($ftyp, $dest, $compressedDir . $fn);
            echo "$dest uploaded and compressed successfully.";
        } else {
            echo "Function Failed.";
        }
    } else if($ftyp == "video/mp4" || $ftyp == "video/mkv" || $ftyp == "video/mpeg4"){
        if (move_uploaded_file($ftl, $dest)) {
            echo "$dest uploaded successfully.";
        }
    }else {
        echo "Unsupported file type: " . $ftyp;
    }
} else {
    echo "Incorrect Parameter";
}

function compressImage($type, $source, $destination, $maxWidth = 800, $maxHeight = 600) {
    list($width, $height) = getimagesize($source);
    $ratio = $width / $height;

    if ($width > $maxWidth || $height > $maxHeight) {
        if ($maxWidth / $maxHeight > $ratio) {
            $maxWidth = $maxHeight * $ratio;
        } else {
            $maxHeight = $maxWidth / $ratio;
        }
    } else {
        $maxWidth = $width;
        $maxHeight = $height;
    }

    $image;
    switch ($type) {
        case 'image/jpeg':
            $image = imagecreatefromjpeg($source);
            break;
        case 'image/png':
            $image = imagecreatefrompng($source);
            break;
        case 'image/gif':
            $image = imagecreatefromgif($source);
            break;
        default:
            return false;
    }

    $thumb = imagecreatetruecolor($maxWidth, $maxHeight);
    imagecopyresampled($thumb, $image, 0, 0, 0, 0, $maxWidth, $maxHeight, $width, $height);

    switch ($type) {
        case 'image/jpeg':
            imagejpeg($thumb, $destination, 75); // Adjust quality from 0 to 100
            break;
        case 'image/png':
            imagepng($thumb, $destination, 6); // Adjust quality from 0 to 9
            break;
        case 'image/gif':
            imagegif($thumb, $destination);
            break;
    }

    return true;
}