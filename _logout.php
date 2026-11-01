<?php
if($_SERVER['REQUEST_METHOD'] == 'POST')
{
    require_once("functions.php");
    deleteCookies();
    header("Location: /vault");
}
?>