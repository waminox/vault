<?php
require_once("functions.php");

        if (!loggedIn()) {

          deleteCookies();
          require_once("_login.php");
        
        }
        else
        {
          include_once("header.php");
          include_once("main.php");
          include_once("footer.php");
        } 
        
?>
