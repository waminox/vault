<?php 

use PHPMailer\PHPMailer\PHPMailer;
use PHPMailer\PHPMailer\Exception;

require 'src/Exception.php';
require 'src/PHPMailer.php';
require 'src/SMTP.php';

function Images($path) {
  $dirPath = dirname(realpath(__FILE__)) . '/' . $path . '/';
  $handle = opendir($dirPath);
  $file_display = ['jpg', 'jpeg', 'png', 'gif'];
  $vault = 'vault';
  $files = [];

  while ($file = readdir($handle)) {
      $fileInfo = pathinfo($file);
      $fileType = isset($fileInfo['extension']) ? strtolower($fileInfo['extension']) : '';

      if ($file !== '.' && $file !== '..' && in_array($fileType, $file_display)) {
          // Add to files array, no need to get modTime for sorting by name
          $files[] = $file;
      }
  }
  closedir($handle);

  // Sort files by name, ascending order
  natsort($files);

  // Output files
  foreach ($files as $file) {
      echo(' 
        <a class="thumbImgContainer lazy-background" href="/' . $vault . '/' . $path . '/' . $file . '" data-bg="/' . $vault . '/' . $path . '/' . 'compressed/' . $file . '" style="background-size: cover;background-repeat: no-repeat;background-position: center;">
            <img class="thumbImg lazy" data-src="/' . $vault . '/' . $path . '/' . 'compressed/' . $file . '" nofollow noopener noreferrer />
        </a>
      ');
  }
}



function Videos($path){

$handle = opendir(dirname(realpath(__FILE__)).'/'.$path.'/');

$file_display = array('mp4','wmv','mpg','mp2','mpeg','mpe','mpv','flv','3gp','ogg','mov');

$vault = 'vault';

$offset = 0;//$_GET['page']; 
$quantity = 500; 
$filelist = scandir(dirname(realpath(__FILE__)).'/'.$path.'/');

//$selectedFiles = array_slice($filelist, $offset-1, $quantity);

foreach($filelist as $file)
{

  $file_type = strtolower(end(explode('.', $file)));

  if($file !== '.' && $file !== '..' && in_array($file_type, $file_display) == true ){

    echo('  

      <video class="lazy-video" width="320" height="240" controls controlsList="nodownload" preload="none">

        <source data-src="/'.$vault."/".$path."/".$file.'">

      Your browser does not support the video tag.

      </video>

    ');      

  }
}
}

function deleteCookies(){
if (isset($_SERVER['HTTP_COOKIE'])) {
  $cookies = explode(';', $_SERVER['HTTP_COOKIE']);
  foreach($cookies as $cookie) {
      $parts = explode('=', $cookie);
      $name = trim($parts[0]);
      setcookie($name, '', time()-3600);
      setcookie($name, '', time()-3600, '/vault');
  }
}
}

function loggedIn(){
    if(!isset($_COOKIE['bG9nZ2VkX2lu']) || $_COOKIE['bG9nZ2VkX2lu'] != "dHJ1ZQ==")
        return false;
    else
        return true;
}

function loadContent() {
  $defaultFolder = 'images'; // Default folder
  $type = isset($_GET['type']) ? $_GET['type'] : $defaultFolder;

  if ($type === 'upload') {
      include_once("_upload.php"); 
      return; 
  }

  if ($type === 'videos') {
      Videos($type); 
  } else {
      Images($type); 
  }
}



function createMenu() {
  $excludeDirs = ['src', 'trash', '.', '..']; // Directories to exclude
  $dirs = array_filter(glob('*'), 'is_dir'); // Get all directories
  $dirs = array_diff($dirs, $excludeDirs); // Exclude specified directories

  // Handle 'images' first if it exists
  if (in_array('images', $dirs)) {
      echo '<li class="nav-item"><a class="nav-link" href="/vault?type=images" role="button"><i class="fas fa-image"></i> ' . htmlspecialchars(ucfirst('images')) . '</a></li>';
      $dirs = array_diff($dirs, ['images']); // Remove 'images' to prevent it from being processed again
  }

  // Temporarily remove 'videos' to process it last
  $hasVideos = in_array('videos', $dirs);
  if ($hasVideos) {
      $dirs = array_diff($dirs, ['videos']); // Remove 'videos' for now
  }

  // Process the rest of the directories
  foreach ($dirs as $dir) {
      // Use the default 'fas fa-image' icon for all except videos
      echo '<li class="nav-item"><a class="nav-link" href="/vault?type=' . htmlspecialchars($dir) . '" role="button"><i class="fas fa-image"></i> ' . htmlspecialchars(ucfirst($dir)) . '</a></li>';
  }

  // Handle 'videos' last if it exists
  if ($hasVideos) {
      echo '<li class="nav-item"><a class="nav-link" href="/vault?type=videos" role="button"><i class="fas fa-video"></i> ' . htmlspecialchars(ucfirst('videos')) . '</a></li>';
  }
}



function guidv4()
{
    if (function_exists('com_create_guid') === true)
        return trim(com_create_guid(), '{}');

    $data = openssl_random_pseudo_bytes(16);
    $data[6] = chr(ord($data[6]) & 0x0f | 0x40); // set version to 0100
    $data[8] = chr(ord($data[8]) & 0x3f | 0x80); // set bits 6-7 to 10
    return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($data), 4));
}

function sendVerificationMail($message){
        
  $mail = new PHPMailer;

  $mail->From = "noreply@joinmymind.com";
  $mail->FromName = "Joinmymind";

  $mail->addAddress("admin@joindmymind.com");

  $mail->isHTML(true);

  $mail->Subject = "Login Verification";
  $mail->Body = $message;
  $mail->send();

}

if(isset($_POST['action']) && !empty($_POST['action']) && $_POST['action'] == "delete") {

  $imgUrl = $_SERVER["DOCUMENT_ROOT"].$_POST['imgUrl'];
  $imgCompressedUrl = preg_replace("#(.*/)#", "$1compressed/", $imgUrl, 1);

  //echo json_encode(array("message"=>"imgUrl: ".$imgUrl." compressed: ".$imgCompressedUrl));

  if(unlink($imgUrl) && unlink($imgCompressedUrl)){
    echo json_encode(array("message"=>$imgUrl." was Successfully deleted."));
  }
  else{
    echo json_encode(array("message"=>$imgUrl." could NOT be deleted. Check the Log."));
  }
}
?>